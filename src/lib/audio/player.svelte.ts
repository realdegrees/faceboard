import { getBridge } from '$lib/bridge';
import { app } from '$lib/stores/app.svelte';

/**
 * Loads local audio files via IPC, decodes them once with Web Audio, caches the
 * AudioBuffers by sound id, and plays them on demand (per-trigger fires or
 * manual previews). `playingIds` is exposed for light UI feedback.
 */
class SoundPlayer {
	playingIds = $state<string[]>([]);
	missing = $state<Record<string, boolean>>({});

	#ctx: AudioContext | null = null;
	#buffers = new Map<string, AudioBuffer>();
	#loading = new Map<string, Promise<AudioBuffer | null>>();

	#context(): AudioContext {
		this.#ctx ??= new AudioContext();
		if (this.#ctx.state === 'suspended') void this.#ctx.resume();
		return this.#ctx;
	}

	async load(soundId: string, filePath: string): Promise<AudioBuffer | null> {
		const cached = this.#buffers.get(soundId);
		if (cached) return cached;
		const inflight = this.#loading.get(soundId);
		if (inflight) return inflight;

		const bridge = getBridge();
		if (!bridge) return null;

		const promise = (async () => {
			try {
				const data = await bridge.sounds.read(filePath);
				const buffer = await this.#context().decodeAudioData(data);
				this.#buffers.set(soundId, buffer);
				this.missing = { ...this.missing, [soundId]: false };
				return buffer;
			} catch (err) {
				console.error(`[sound] failed to load ${filePath}`, err);
				this.missing = { ...this.missing, [soundId]: true };
				return null;
			} finally {
				this.#loading.delete(soundId);
			}
		})();
		this.#loading.set(soundId, promise);
		return promise;
	}

	async play(soundId: string, volumeOverride?: number): Promise<void> {
		const sound = app.settings.sounds.find((s) => s.id === soundId);
		if (!sound) return;
		const buffer = this.#buffers.get(soundId) ?? (await this.load(soundId, sound.path));
		if (!buffer) return;

		const ctx = this.#context();
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const gain = ctx.createGain();
		gain.gain.value = volumeOverride ?? sound.volume ?? 1;
		src.connect(gain).connect(ctx.destination);
		src.start();

		this.playingIds = [...this.playingIds, soundId];
		src.onended = () => {
			const i = this.playingIds.indexOf(soundId);
			if (i >= 0) this.playingIds = [...this.playingIds.slice(0, i), ...this.playingIds.slice(i + 1)];
		};
	}

	/** Drop a cached buffer (e.g. after the file path changes). */
	invalidate(soundId: string): void {
		this.#buffers.delete(soundId);
	}

	/** Warm the cache for all known sounds. */
	preloadAll(): void {
		for (const s of app.settings.sounds) void this.load(s.id, s.path);
	}
}

export const soundPlayer = new SoundPlayer();
