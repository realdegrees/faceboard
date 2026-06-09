import { Detector, type ModalityFlags } from './mediapipe';
import type { DetectionFrame, FaceData, HandData } from './types';

export type EngineStatus = 'idle' | 'loading' | 'running' | 'error';

export interface CameraDevice {
	deviceId: string;
	label: string;
}

/**
 * Long-lived detection engine. Owns an offscreen <video> fed by either a local
 * webcam or a remote (phone) MediaStream, and a setInterval-driven detection
 * loop. The loop uses setInterval (not requestAnimationFrame) plus the window's
 * `backgroundThrottling: false` so detection keeps running while minimized or in
 * the tray. It is a module singleton so navigating between routes never stops it.
 */
class DetectionEngine {
	status = $state<EngineStatus>('idle');
	error = $state<string | null>(null);
	fps = $state(0);
	face = $state<FaceData | null>(null);
	hands = $state<HandData[]>([]);
	devices = $state<CameraDevice[]>([]);
	stream = $state<MediaStream | null>(null);
	targetFps = $state(18);
	modalities = $state<ModalityFlags>({ face: true, hand: true });

	/** Hook for the matching engine (wired in a later milestone). */
	onFrame: ((frame: DetectionFrame) => void) | null = null;

	#detector = new Detector();
	#video: HTMLVideoElement | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#external = false;
	#lastTs = 0;
	#frameCount = 0;
	#fpsWindowStart = 0;

	get active(): boolean {
		return this.status === 'running';
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

	/** Start detection from a local webcam. */
	async startLocal(deviceId?: string | null): Promise<void> {
		if (this.status === 'loading' || this.status === 'running') return;
		this.status = 'loading';
		this.error = null;
		try {
			await this.#detector.init(this.modalities);
			const stream = await navigator.mediaDevices.getUserMedia({
				video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
				audio: false
			});
			this.#external = false;
			await this.#useStream(stream);
			await this.refreshDevices();
			this.#startLoop();
			this.status = 'running';
		} catch (err) {
			this.#teardownStream();
			this.status = 'error';
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	/** Start (or switch to) detection from an externally supplied stream (phone). */
	async useExternalStream(stream: MediaStream): Promise<void> {
		this.status = 'loading';
		this.error = null;
		try {
			await this.#detector.init(this.modalities);
			this.#external = true;
			await this.#useStream(stream);
			this.#startLoop();
			this.status = 'running';
		} catch (err) {
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
	 * engine is already running. */
	async ensureModalities(modalities: ModalityFlags): Promise<void> {
		this.modalities = modalities;
		if (this.status === 'running') await this.#detector.init(modalities);
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

		let frame: DetectionFrame;
		try {
			frame = this.#detector.detect(v, ts, this.modalities);
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

	#teardownStream(): void {
		if (this.stream && !this.#external) {
			for (const t of this.stream.getTracks()) t.stop();
		}
		this.stream = null;
		if (this.#video) this.#video.srcObject = null;
	}

	stop(): void {
		this.#stopLoop();
		this.#teardownStream();
		this.face = null;
		this.hands = [];
		this.fps = 0;
		if (this.status !== 'error') this.status = 'idle';
	}
}

export const engine = new DetectionEngine();
