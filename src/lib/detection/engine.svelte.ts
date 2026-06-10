import { Detector, type ModalityFlags } from './mediapipe';
import type { DetectionFrame, FaceData, HandData } from './types';

export type EngineStatus = 'idle' | 'loading' | 'error';

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

	/** Hook for the matching engine. */
	onFrame: ((frame: DetectionFrame) => void) | null = null;

	#detector = new Detector();
	#video: HTMLVideoElement | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#external = false;
	#lastTs = 0;
	#frameCount = 0;
	#fpsWindowStart = 0;

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
			await this.#detector.init(this.modalities);
			this.delegate = this.#detector.delegate;
			if (!this.glRenderer) {
				this.glRenderer = detectGlRenderer();
				console.info(`[faceboard] detection delegate=${this.delegate} renderer=${this.glRenderer}`);
			}
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
			await this.#detector.init(this.modalities);
			this.delegate = this.#detector.delegate;
			if (!this.glRenderer) {
				this.glRenderer = detectGlRenderer();
				console.info(`[faceboard] detection delegate=${this.delegate} renderer=${this.glRenderer}`);
			}
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
		if (this.detecting) await this.#detector.init(modalities);
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

	#startLoop(): void {
		this.#stopLoop();
		this.#fpsWindowStart = performance.now();
		this.#frameCount = 0;
		this.#timer = setTimeout(() => this.#tick(), 0);
	}

	#stopLoop(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
	}

	/**
	 * One detection per tick: both detectors run on the SAME frame so the face mesh
	 * and hand skeleton are always in sync. The raw <video> element is handed
	 * straight to MediaPipe (no intermediate 2D canvas / CSS filter) so the GPU
	 * delegate can upload the video texture directly — the canonical fast path; a
	 * filtered canvas both adds main-thread work and defeats that upload.
	 *
	 * Self-pacing: the next tick is scheduled AFTER this one finishes, aiming for
	 * the target frame period but always yielding a little to the UI. So when
	 * inference is cheap (GPU) we hit ~targetFps, and when it's expensive (CPU
	 * fallback) fps degrades gracefully instead of the main thread saturating.
	 */
	#tick(): void {
		this.#timer = null;
		const start = performance.now();
		try {
			const v = this.#video;
			if (!v || v.readyState < 2) return;
			// MediaPipe requires strictly increasing timestamps per detector.
			const ts = Math.max(start, this.#lastTs + 1);
			this.#lastTs = ts;

			// Only fall back to a canvas to physically rotate a sideways (phone) feed;
			// otherwise feed the video element itself.
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

			this.#frameCount++;
			const elapsed = ts - this.#fpsWindowStart;
			if (elapsed >= 500) {
				this.fps = Math.round((this.#frameCount / elapsed) * 1000);
				this.#frameCount = 0;
				this.#fpsWindowStart = ts;
			}
		} finally {
			if (this.detecting) {
				const period = Math.max(1000 / this.targetFps, 8);
				const used = performance.now() - start;
				// Aim for the target period; always leave a small gap so rendering and
				// input get a turn even when inference eats most of the budget.
				this.#timer = setTimeout(() => this.#tick(), Math.max(6, period - used));
			}
		}
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
