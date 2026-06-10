import { Detector, type Delegate, type ModalityFlags } from './mediapipe';
import { FaceSmoother } from './smoothing';
import type { DetectionFrame, FaceData, HandData } from './types';

export type EngineStatus = 'idle' | 'loading' | 'error';

/** Messages posted back by the detection worker. */
type WorkerOut =
	| { type: 'ready'; delegate: Delegate }
	| { type: 'error'; error: string }
	| { type: 'result'; ts: number; face: FaceData | null; hands: HandData[] };

// Cap the long side of the frame fed to MediaPipe. The models resize to a small
// internal resolution so inference cost barely changes with input size, but a
// smaller frame makes the per-frame ImageBitmap transfer to the worker much
// cheaper. 640 keeps enough detail for accurate/stable landmarks (a face filling
// half the frame is still ~180px) while cutting transfer ~4x vs full 720p.
// Landmarks are normalized [0,1], so this never shifts the preview overlay.
const DETECT_MAX_DIM = 640;

export interface CameraDevice {
	deviceId: string;
	label: string;
}

// Renderer strings that mean WebGL is software-emulated (no real GPU). On these,
// MediaPipe's GPU delegate is slower than CPU, so we pick CPU instead.
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

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
	#initPromise: Promise<void> | null = null;

	// Canvas reused only to rotate sideways (phone) feeds before inference.
	#procCanvas: HTMLCanvasElement | null = null;
	// One Euro smoothing of blendshapes + head pose (de-jitter for clean matching).
	#faceSmoother = new FaceSmoother();

	#smoothFace(face: FaceData | null, ts: number): FaceData | null {
		if (!face) {
			this.#faceSmoother.reset();
			return null;
		}
		return this.#faceSmoother.apply(face, ts);
	}

	/** True when WebGL is software-emulated — detection then runs on the CPU
	 *  delegate (faster than software "GPU"), and the UI flags it for the user. */
	get softwareGl(): boolean {
		return SOFTWARE_GL.test(this.glRenderer);
	}

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
		this.#faceSmoother.reset();
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
		if (this.detecting) {
			await this.#ensureDetector(modalities);
			// Re-seed the loop: if #ensureDetector fell back worker→main the
			// result-driven worker chain is gone, and a clean restart is harmless
			// in either mode (#startLoop stops first).
			if (this.detecting) this.#startLoop();
		}
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
		// Decide delegate AND thread from the WebGL renderer, up front:
		//  • Real GPU → GPU delegate on the MAIN THREAD. Inference is fast there, and
		//    handing MediaPipe the raw <video> avoids the worker's per-frame GPU→CPU
		//    readback to transfer each frame — lowest latency, tightest overlay. This
		//    is the canonical hand-rolled path.
		//  • Software WebGL (SwiftShader/llvmpipe) → CPU delegate (the "GPU" path is
		//    software here and ~3.7× slower; measured ~7fps vs ~25fps) in the WORKER,
		//    so the slow inference doesn't block the UI thread.
		if (!this.glRenderer) this.glRenderer = detectGlRenderer();
		const sw = this.softwareGl;
		const prefer: Delegate = sw ? 'CPU' : 'GPU';
		this.#mode = sw ? 'worker' : 'main';

		if (this.#mode === 'worker') {
			try {
				await this.#initWorker(modalities, prefer);
			} catch (err) {
				console.warn('[faceboard] detection worker unavailable, using main thread:', err);
				this.#mode = 'main';
				this.#teardownWorker();
				await this.#detector.init(modalities, prefer);
				this.delegate = this.#detector.delegate;
			}
		} else {
			this.#teardownWorker(); // never leave a worker running in main-thread mode
			await this.#detector.init(modalities, prefer);
			this.delegate = this.#detector.delegate;
		}
		this.detectMode = this.#mode;
		console.info(
			`[faceboard] detection mode=${this.#mode} delegate=${this.delegate} renderer=${this.glRenderer}`
		);
	}

	#initWorker(modalities: ModalityFlags, prefer: Delegate): Promise<void> {
		// Coalesce overlapping inits onto one promise so a second caller never
		// orphans the first's resolver (which would hang it forever).
		if (this.#initPromise) return this.#initPromise;
		if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
			return Promise.reject(new Error('Worker / createImageBitmap unsupported'));
		}
		if (!this.#worker) {
			this.#worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
			this.#worker.onmessage = (e) => this.#onWorkerMessage(e.data);
			this.#worker.onerror = (e) => this.#onWorkerError(e);
		}
		this.#initPromise = new Promise<void>((resolve, reject) => {
			const settle = () => {
				if (this.#initTimeout) clearTimeout(this.#initTimeout);
				this.#initTimeout = null;
				this.#initResolve = this.#initReject = null;
				this.#initPromise = null;
			};
			this.#initResolve = () => {
				settle();
				resolve();
			};
			this.#initReject = (e) => {
				settle();
				reject(e);
			};
			this.#initTimeout = setTimeout(() => this.#initReject?.(new Error('worker init timeout')), 8000);
			this.#worker!.postMessage({ type: 'init', modalities, delegate: prefer });
		});
		return this.#initPromise;
	}

	#onWorkerMessage(msg: WorkerOut): void {
		if (msg.type === 'ready') {
			this.delegate = msg.delegate;
			this.#initResolve?.(); // settles + clears the init promise/timeout
			return;
		}
		if (msg.type === 'error') {
			this.#initReject?.(new Error(msg.error));
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
		this.face = this.#smoothFace(msg.face, msg.ts);
		this.hands = msg.hands;
		this.onFrame?.({ tsMs: msg.ts, face: this.face, hands: msg.hands });
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
			this.#initReject(new Error(reason)); // settles + clears
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
		// Arm the watchdog up front so neither a stuck capture nor a dropped worker
		// reply can pin #busy forever — it resets and re-sends after 3s.
		this.#armWatchdog();
		const rotated = ((this.rotation % 360) + 360) % 360 !== 0;
		let bitmap: ImageBitmap;
		try {
			if (rotated) {
				// #rotateToCanvas already downscales to DETECT_MAX_DIM.
				bitmap = await createImageBitmap(this.#rotateToCanvas(v));
			} else {
				// Downscale during bitmap creation: a smaller bitmap means a much
				// cheaper GPU→CPU readback to transfer it to the worker and a cheaper
				// re-upload there. Landmarks stay normalized so alignment is unaffected.
				const vw = v.videoWidth || 640;
				const vh = v.videoHeight || 480;
				const scale = Math.min(1, DETECT_MAX_DIM / Math.max(vw, vh));
				bitmap =
					scale < 1
						? await createImageBitmap(v, {
								resizeWidth: Math.round(vw * scale),
								resizeHeight: Math.round(vh * scale),
								resizeQuality: 'medium'
							})
						: await createImageBitmap(v);
			}
		} catch {
			if (this.#watchdog) clearTimeout(this.#watchdog);
			this.#watchdog = null;
			this.#busy = false;
			if (this.detecting) this.#timer = setTimeout(() => void this.#sendFrame(), 60);
			return;
		}
		// Superseded while capturing (watchdog fired / stop / restart bumped #lastTs):
		// drop this frame; the current in-flight frame owns #busy + the watchdog.
		if (!this.detecting || this.#mode !== 'worker' || !this.#worker || this.#lastTs !== ts) {
			bitmap.close();
			return;
		}
		this.#worker.postMessage({ type: 'frame', bitmap, ts, modalities: this.modalities }, [bitmap]);
	}

	#armWatchdog(): void {
		if (this.#watchdog) clearTimeout(this.#watchdog);
		this.#watchdog = setTimeout(() => {
			this.#watchdog = null;
			this.#busy = false;
			if (this.detecting && this.#mode === 'worker') void this.#sendFrame();
		}, 3000);
	}

	/**
	 * Main-thread loop — the primary path on a real GPU (and the worker fallback).
	 * Both detectors run on the same frame and the raw <video> goes straight to
	 * MediaPipe (no canvas/transfer), so the overlay has the lowest latency.
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
			this.face = this.#smoothFace(frame.face, ts);
			this.hands = frame.hands;
			this.onFrame?.({ tsMs: ts, face: this.face, hands: frame.hands });
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
		this.#initPromise = null;
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
