import { Detector, type ModalityFlags } from './mediapipe';
import type { DetectionFrame, FaceData, HandData } from './types';

export type EngineStatus = 'idle' | 'loading' | 'error';

export interface CameraDevice {
	deviceId: string;
	label: string;
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
	face = $state<FaceData | null>(null);
	hands = $state<HandData[]>([]);
	devices = $state<CameraDevice[]>([]);
	stream = $state<MediaStream | null>(null);
	targetFps = $state(18);
	modalities = $state<ModalityFlags>({ face: true, hand: true });
	/** Whether the active stream is the local webcam or a paired phone. */
	source = $state<'local' | 'phone'>('local');
	/** Adaptive low-light boost on the detection input. */
	enhance = $state(true);

	/** Hook for the matching engine. */
	onFrame: ((frame: DetectionFrame) => void) | null = null;

	#detector = new Detector();
	#video: HTMLVideoElement | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#external = false;
	#lastTs = 0;
	#frameCount = 0;
	#fpsWindowStart = 0;

	// Low-light preprocessing
	#procCanvas: HTMLCanvasElement | null = null;
	#sampleCanvas: HTMLCanvasElement | null = null;
	#brightness = 1;
	#contrast = 1;
	#sampleTick = 0;

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
			const stream = await navigator.mediaDevices.getUserMedia({
				video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
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
		const interval = Math.max(1000 / this.targetFps, 8);
		this.#fpsWindowStart = performance.now();
		this.#frameCount = 0;
		this.#timer = setInterval(() => this.#tick(), interval);
	}

	#stopLoop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	#tick(): void {
		const v = this.#video;
		if (!v || v.readyState < 2) return;
		// MediaPipe requires strictly increasing timestamps per detector.
		const ts = Math.max(performance.now(), this.#lastTs + 1);
		this.#lastTs = ts;

		const input = this.enhance ? this.#preprocess(v) : v;
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
	}

	/** Draw the frame to an offscreen canvas with an adaptive brightness/contrast
	 * boost so the detector sees a clearer image in low light. */
	#preprocess(video: HTMLVideoElement): HTMLCanvasElement {
		const w = video.videoWidth || 640;
		const h = video.videoHeight || 480;
		const canvas = (this.#procCanvas ??= document.createElement('canvas'));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const ctx = canvas.getContext('2d');
		if (!ctx) return canvas;
		if (this.#sampleTick++ % 12 === 0) this.#adaptExposure(video);
		ctx.filter = `brightness(${this.#brightness.toFixed(2)}) contrast(${this.#contrast.toFixed(2)}) saturate(1.04)`;
		ctx.drawImage(video, 0, 0, w, h);
		ctx.filter = 'none';
		return canvas;
	}

	#adaptExposure(video: HTMLVideoElement): void {
		const s = (this.#sampleCanvas ??= document.createElement('canvas'));
		s.width = 24;
		s.height = 24;
		const ctx = s.getContext('2d', { willReadFrequently: true });
		if (!ctx) return;
		try {
			ctx.drawImage(video, 0, 0, 24, 24);
			const data = ctx.getImageData(0, 0, 24, 24).data;
			let sum = 0;
			for (let i = 0; i < data.length; i += 4) {
				sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			}
			const meanLuma = sum / (data.length / 4) / 255;
			const desired = meanLuma > 0.001 ? 0.5 / meanLuma : 1;
			const clamped = Math.max(1, Math.min(2.3, desired));
			this.#brightness += (clamped - this.#brightness) * 0.4;
			this.#contrast = 1 + (this.#brightness - 1) * 0.35;
		} catch {
			/* not ready — skip */
		}
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
