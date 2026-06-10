import { Detector, type Delegate, type ModalityFlags } from './mediapipe';
import type { DetectionFrame, FaceData, HandData } from './types';

export type EngineStatus = 'idle' | 'loading' | 'error';

/** Messages posted back by the detection worker. */
type WorkerOut =
	| { type: 'ready'; delegate: Delegate }
	| { type: 'error'; error: string }
	| { type: 'result'; ts: number; face: FaceData | null; hands: HandData[] };

// Cap the long side of the frame fed to MediaPipe. Inference + GPU-upload cost
// scales with input size and the models resize to a small internal resolution
// anyway, so a full-res webcam frame is wasted work. Landmarks are normalized
// [0,1], so downscaling the detector input doesn't shift the preview overlay.
const DETECT_MAX_DIM = 480;

export interface CameraDevice {
	deviceId: string;
	label: string;
}

/** Unmasked WebGL renderer string — reveals whether we're on a real GPU or a
 *  software rasterizer (SwiftShader / llvmpipe), which is the usual cause of a
 *  ~5fps inference cliff even though the delegate still reports "GPU". */
function detectGlRenderer(): string {
	try {
		const c = document.createElement('canvas');
		const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
		if (!gl) return 'no-webgl';
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
		return typeof r === 'string' ? r : 'unknown';
	} catch {
		return 'unknown';
	}
}

/** Friendlier message for common getUserMedia failures. */
function cameraError(err: unknown): string {
	const name = (err as { name?: string } | null)?.name;
	switch (name) {
		case 'NotFoundError':
		case 'DevicesNotFoundError':
			return 'No camera found.';
		case 'NotAllowedError':
		case 'PermissionDeniedError':
			return 'Camera permission denied.';
		case 'NotReadableError':
		case 'TrackStartError':
			return 'Camera is in use by another app.';
		case 'OverconstrainedError':
			return 'Selected camera is unavailable.';
		default:
			return err instanceof Error ? err.message : String(err);
	}
}

/**
 * Long-lived engine. Owns an offscreen <video> fed by a local webcam or a paired
 * phone stream. The **camera** (live preview + device list) is decoupled from
 * **detection** (the MediaPipe loop): the camera can be on for preview without
 * detection running. The loop uses setInterval + the window's
 * `backgroundThrottling: false` so it keeps running while minimized / in the tray.
 * It is a module singleton, so navigating between routes never stops it.
 */
class DetectionEngine {
	status = $state<EngineStatus>('idle');
	error = $state<string | null>(null);
	/** Detection loop (MediaPipe) is running. */
	detecting = $state(false);
	fps = $state(0);
	// Replaced wholesale every frame and only ever read (never mutated in place), so
	// `$state.raw` skips the deep-proxy churn that otherwise runs ~18×/sec over every
	// landmark — a real cost in the draw loop when a hand is tracked.
	face = $state.raw<FaceData | null>(null);
	hands = $state.raw<HandData[]>([]);
	devices = $state<CameraDevice[]>([]);
	stream = $state<MediaStream | null>(null);
	targetFps = $state(30);
	modalities = $state<ModalityFlags>({ face: true, hand: true });
	/** Whether the active stream is the local webcam or a paired phone. */
	source = $state<'local' | 'phone'>('local');
	/** Display + detection rotation in degrees (0/90/180/270) for sideways feeds. */
	rotation = $state(0);
	/** Which MediaPipe delegate ended up active (GPU is ~10× faster than the CPU
	 *  fallback). Surfaced so a slow CPU fallback is visible, not silent. */
	delegate = $state<'GPU' | 'CPU'>('GPU');
	/** Unmasked WebGL renderer. If this contains "SwiftShader"/"llvmpipe" the GPU
	 *  delegate is actually running on a software rasterizer (the real cause of a
	 *  ~5fps cliff) — surfaced so that's diagnosable, not silent. */
	glRenderer = $state('');
	/** Whether inference runs off-thread (worker) or on the main-thread fallback. */
	detectMode = $state<'worker' | 'main'>('worker');

	/** Hook for the matching engine. */
	onFrame: ((frame: DetectionFrame) => void) | null = null;

	#detector = new Detector(); // main-thread fallback only
	#video: HTMLVideoElement | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#external = false;
	#lastTs = 0;
	#frameCount = 0;
	#fpsWindowStart = 0;

	// Off-thread inference (preferred). Falls back to the main-thread #detector if
	// the worker can't be created (unsupported / packaging issue).
	#mode: 'worker' | 'main' = 'worker';
	#worker: Worker | null = null;
	#busy = false; // a frame is in flight to the worker
	#lastSend = 0;
	#watchdog: ReturnType<typeof setTimeout> | null = null;
	#initResolve: (() => void) | null = null;
	#initReject: ((e: unknown) => void) | null = null;
	#initTimeout: ReturnType<typeof setTimeout> | null = null;

	// Canvas reused only to rotate sideways (phone) feeds before inference.
	#procCanvas: HTMLCanvasElement | null = null;

	/** Back-compat: "active" means detection is running. */
	get active(): boolean {
		return this.detecting;
	}
	get cameraOn(): boolean {
		return this.stream !== null;
	}

	#ensureVideo(): HTMLVideoElement {
		if (this.#video) return this.#video;
		const v = document.createElement('video');
		v.muted = true;
		v.playsInline = true;
		v.autoplay = true;
		// Kept rendered-but-invisible (not display:none) so frames keep decoding.
		v.style.cssText =
			'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;';
		document.body.appendChild(v);
		this.#video = v;
		return v;
	}

	/** Turn the local webcam on for preview (no detection). Also used to switch
	 *  the active camera; if detection is running it resumes on the new stream. */
	async openCamera(deviceId?: string | null): Promise<void> {
		if (this.status === 'loading') return;
		this.status = 'loading';
		this.error = null;
		try {
			// Cap the source at 720p: plenty for face+hand landmarks and a clean
			// preview, but bounds the per-frame GPU texture upload so a 1080p/4K
			// webcam doesn't tank inference. The video element is fed to MediaPipe
			// directly, so the capture resolution IS the inference resolution.
			const res = { width: { ideal: 1280 }, height: { ideal: 720 } };
			const stream = await navigator.mediaDevices.getUserMedia({
				video: deviceId ? { deviceId: { exact: deviceId }, ...res } : { facingMode: 'user', ...res },
				audio: false
			});
			this.#external = false;
			this.source = 'local';
			await this.#useStream(stream);
			await this.refreshDevices();
			this.status = 'idle';
			if (this.detecting) this.#startLoop();
		} catch (err) {
			this.#teardownStream();
			this.status = 'error';
			this.error = cameraError(err);
		}
	}

	/** Start the detection loop, opening the camera first if it isn't already on. */
	async startDetection(deviceId?: string | null): Promise<void> {
		if (!this.stream) {
			await this.openCamera(deviceId);
			if (!this.stream) return; // camera failed; error already set
		}
		this.status = 'loading';
		try {
			await this.#ensureDetector(this.modalities);
			this.detecting = true;
			this.#startLoop();
			this.status = 'idle';
		} catch (err) {
			this.detecting = false;
			this.status = 'error';
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	/** Stop the detection loop but keep the camera on for preview. */
	stopDetection(): void {
		this.#stopLoop();
		this.detecting = false;
		this.face = null;
		this.hands = [];
		this.fps = 0;
	}

	/** Start (or switch to) detection from an externally supplied stream (phone). */
	async useExternalStream(stream: MediaStream): Promise<void> {
		this.status = 'loading';
		this.error = null;
		try {
			await this.#ensureDetector(this.modalities);
			this.#external = true;
			this.source = 'phone';
			await this.#useStream(stream);
			this.detecting = true;
			this.#startLoop();
			this.status = 'idle';
		} catch (err) {
			this.detecting = false;
			this.status = 'error';
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	async #useStream(stream: MediaStream): Promise<void> {
		this.#stopLoop();
		// Stop the previous local stream's tracks (don't kill an external one).
		if (this.stream && this.stream !== stream && !this.#external) {
			for (const t of this.stream.getTracks()) t.stop();
		}
		const v = this.#ensureVideo();
		v.srcObject = stream;
		this.stream = stream;
		await v.play().catch(() => {});
		if (v.readyState < 2) {
			await new Promise<void>((resolve) =>
				v.addEventListener('loadeddata', () => resolve(), { once: true })
			);
		}
	}

	/** Ensure the given modalities are active, lazily creating detectors if the
	 * loop is already running. */
	async ensureModalities(modalities: ModalityFlags): Promise<void> {
		this.modalities = modalities;
		if (this.detecting) await this.#ensureDetector(modalities);
	}

	async refreshDevices(): Promise<void> {
		try {
			const all = await navigator.mediaDevices.enumerateDevices();
			this.devices = all
				.filter((d) => d.kind === 'videoinput')
				.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
		} catch {
			this.devices = [];
		}
	}

	/** Create (or re-init for new modalities) the off-thread worker; fall back to
	 *  the main-thread detector if the worker can't be brought up. */
	async #ensureDetector(modalities: ModalityFlags): Promise<void> {
		if (this.#mode === 'worker') {
			try {
				await this.#initWorker(modalities);
			} catch (err) {
				console.warn('[faceboard] detection worker unavailable, using main thread:', err);
				this.#mode = 'main';
				this.#teardownWorker();
				await this.#detector.init(modalities);
				this.delegate = this.#detector.delegate;
			}
		} else {
			await this.#detector.init(modalities);
			this.delegate = this.#detector.delegate;
		}
		this.detectMode = this.#mode;
		if (!this.glRenderer) {
			this.glRenderer = detectGlRenderer();
			console.info(
				`[faceboard] detection mode=${this.#mode} delegate=${this.delegate} renderer=${this.glRenderer}`
			);
		}
	}

	#initWorker(modalities: ModalityFlags): Promise<void> {
		if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
			return Promise.reject(new Error('Worker / createImageBitmap unsupported'));
		}
		if (!this.#worker) {
			this.#worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
			this.#worker.onmessage = (e) => this.#onWorkerMessage(e.data);
			this.#worker.onerror = (e) => this.#onWorkerError(e);
		}
		return new Promise<void>((resolve, reject) => {
			this.#initResolve = resolve;
			this.#initReject = reject;
			this.#initTimeout = setTimeout(() => {
				this.#initReject?.(new Error('worker init timeout'));
				this.#initResolve = this.#initReject = null;
			}, 8000);
			this.#worker!.postMessage({ type: 'init', modalities });
		});
	}

	#onWorkerMessage(msg: WorkerOut): void {
		if (msg.type === 'ready') {
			this.delegate = msg.delegate;
			if (this.#initTimeout) clearTimeout(this.#initTimeout);
			this.#initResolve?.();
			this.#initResolve = this.#initReject = null;
			return;
		}
		if (msg.type === 'error') {
			if (this.#initTimeout) clearTimeout(this.#initTimeout);
			this.#initReject?.(new Error(msg.error));
			this.#initResolve = this.#initReject = null;
			return;
		}
		// result — ignore a stale frame superseded by a restart (a newer frame is
		// already in flight, so leave #busy and its watchdog untouched).
		if (msg.ts !== this.#lastTs) return;
		this.#busy = false;
		if (this.#watchdog) {
			clearTimeout(this.#watchdog);
			this.#watchdog = null;
		}
		if (!this.detecting || this.#mode !== 'worker') return;
		this.face = msg.face;
		this.hands = msg.hands;
		this.onFrame?.({ tsMs: msg.ts, face: msg.face, hands: msg.hands });
		this.#countFps();
		// Pace the next send toward targetFps (measured from the last send so the
		// rate is min(targetFps, worker throughput)).
		const period = Math.max(1000 / this.targetFps, 8);
		const since = performance.now() - this.#lastSend;
		this.#timer = setTimeout(() => void this.#sendFrame(), Math.max(0, period - since));
	}

	#onWorkerError(e: ErrorEvent): void {
		const reason = e.message || 'worker error';
		if (this.#initReject) {
			if (this.#initTimeout) clearTimeout(this.#initTimeout);
			this.#initReject(new Error(reason));
			this.#initResolve = this.#initReject = null;
			return;
		}
		// Crash mid-run: drop to the main-thread detector and keep going.
		if (this.#mode === 'worker' && this.detecting) {
			console.warn('[faceboard] detection worker crashed, switching to main thread:', reason);
			this.#mode = 'main';
			this.#teardownWorker();
			void this.#detector.init(this.modalities).then(() => {
				this.delegate = this.#detector.delegate;
				if (this.detecting) this.#startLoop();
			});
		}
	}

	#startLoop(): void {
		this.#stopLoop();
		this.#fpsWindowStart = performance.now();
		this.#frameCount = 0;
		if (this.#mode === 'worker') {
			this.#busy = false;
			void this.#sendFrame();
		} else {
			this.#timer = setTimeout(() => this.#tickMain(), 0);
		}
	}

	#stopLoop(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		if (this.#watchdog) clearTimeout(this.#watchdog);
		this.#watchdog = null;
		this.#busy = false;
	}

	/**
	 * Worker pipeline: grab the current video frame as an ImageBitmap and transfer
	 * it (zero-copy) to the worker, which runs BOTH detectors on it and posts the
	 * landmarks back. One frame in flight at a time; the next is sent when the
	 * result returns. The main thread only does the cheap capture, so inference
	 * never blocks the UI.
	 */
	async #sendFrame(): Promise<void> {
		this.#timer = null;
		if (!this.detecting || this.#mode !== 'worker' || !this.#worker || this.#busy) return;
		const v = this.#video;
		if (!v || v.readyState < 2) {
			this.#timer = setTimeout(() => void this.#sendFrame(), 60);
			return;
		}
		this.#busy = true;
		this.#lastSend = performance.now();
		const ts = Math.max(this.#lastSend, this.#lastTs + 1);
		this.#lastTs = ts;
		const rotated = ((this.rotation % 360) + 360) % 360 !== 0;
		let bitmap: ImageBitmap;
		try {
			bitmap = await createImageBitmap(rotated ? this.#rotateToCanvas(v) : v);
		} catch {
			this.#busy = false;
			if (this.detecting) this.#timer = setTimeout(() => void this.#sendFrame(), 60);
			return;
		}
		if (!this.detecting || this.#mode !== 'worker' || !this.#worker) {
			bitmap.close();
			this.#busy = false;
			return;
		}
		this.#worker.postMessage({ type: 'frame', bitmap, ts, modalities: this.modalities }, [bitmap]);
		// Recover if a frame's result never comes back (dropped message / stall).
		this.#watchdog = setTimeout(() => {
			this.#busy = false;
			if (this.detecting && this.#mode === 'worker') void this.#sendFrame();
		}, 3000);
	}

	/**
	 * Main-thread fallback loop (used only when the worker is unavailable). Both
	 * detectors run on the same frame; the raw <video> goes straight to MediaPipe.
	 * Self-paced toward targetFps with a small floor so the UI still gets a turn.
	 */
	#tickMain(): void {
		this.#timer = null;
		const start = performance.now();
		try {
			const v = this.#video;
			if (!v || v.readyState < 2) return;
			const ts = Math.max(start, this.#lastTs + 1);
			this.#lastTs = ts;
			const rotated = ((this.rotation % 360) + 360) % 360 !== 0;
			const input = rotated ? this.#rotateToCanvas(v) : v;
			let frame: DetectionFrame;
			try {
				frame = this.#detector.detect(input, ts, this.modalities);
			} catch (err) {
				this.error = err instanceof Error ? err.message : String(err);
				return;
			}
			this.face = frame.face;
			this.hands = frame.hands;
			this.onFrame?.(frame);
			this.#countFps();
		} finally {
			if (this.detecting && this.#mode === 'main') {
				const period = Math.max(1000 / this.targetFps, 8);
				const used = performance.now() - start;
				this.#timer = setTimeout(() => this.#tickMain(), Math.max(6, period - used));
			}
		}
	}

	#countFps(): void {
		this.#frameCount++;
		const elapsed = performance.now() - this.#fpsWindowStart;
		if (elapsed >= 500) {
			this.fps = Math.round((this.#frameCount / elapsed) * 1000);
			this.#frameCount = 0;
			this.#fpsWindowStart = performance.now();
		}
	}

	#teardownWorker(): void {
		if (this.#initTimeout) clearTimeout(this.#initTimeout);
		this.#initTimeout = null;
		this.#initResolve = this.#initReject = null;
		this.#worker?.terminate();
		this.#worker = null;
		this.#busy = false;
	}

	/** Rotate a sideways feed into an offscreen canvas (downscaled) for detection.
	 *  Landmarks come back normalized in this rotated frame, matching the preview. */
	#rotateToCanvas(video: HTMLVideoElement): HTMLCanvasElement {
		const r = ((this.rotation % 360) + 360) % 360;
		const swap = r === 90 || r === 270;
		const vw = video.videoWidth || 640;
		const vh = video.videoHeight || 480;
		const scale = Math.min(1, DETECT_MAX_DIM / Math.max(vw, vh));
		const fw = Math.round(vw * scale);
		const fh = Math.round(vh * scale);
		const cw = swap ? fh : fw;
		const ch = swap ? fw : fh;
		const canvas = (this.#procCanvas ??= document.createElement('canvas'));
		if (canvas.width !== cw) canvas.width = cw;
		if (canvas.height !== ch) canvas.height = ch;
		const ctx = canvas.getContext('2d');
		if (!ctx) return canvas;
		ctx.save();
		ctx.translate(cw / 2, ch / 2);
		ctx.rotate((r * Math.PI) / 180);
		ctx.drawImage(video, -fw / 2, -fh / 2, fw, fh);
		ctx.restore();
		return canvas;
	}

	#teardownStream(): void {
		if (this.stream && !this.#external) {
			for (const t of this.stream.getTracks()) t.stop();
		}
		this.stream = null;
		if (this.#video) this.#video.srcObject = null;
	}

	/** Stop everything: detection loop + camera. */
	closeCamera(): void {
		this.#stopLoop();
		this.#teardownStream();
		this.detecting = false;
		this.face = null;
		this.hands = [];
		this.fps = 0;
		if (this.status !== 'error') this.status = 'idle';
	}

	/** Back-compat alias. */
	stop(): void {
		this.closeCamera();
	}
}

export const engine = new DetectionEngine();
