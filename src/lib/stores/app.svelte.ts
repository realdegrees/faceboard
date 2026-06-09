import { getBridge } from '$lib/bridge';
import {
	defaultSettings,
	migrateSettings,
	type FaceboardSettings,
	type GeneralSettings,
	type Shortcuts,
	type Sound,
	type Trigger
} from '$lib/types';

/**
 * Single source of truth for persisted app state, backed by `$state` runes.
 *
 * Loaded once from the Electron settings file; every mutation is an explicit
 * method called from an event handler (never a mirror `$effect`) and is written
 * back through a debounced `persist()`. `$state.snapshot` produces the plain
 * object that crosses the IPC boundary.
 */
class AppStore {
	loaded = $state(false);
	settings = $state<FaceboardSettings>(defaultSettings());

	#saveTimer: ReturnType<typeof setTimeout> | null = null;

	async load(): Promise<void> {
		const bridge = getBridge();
		if (bridge) {
			const raw = await bridge.settings.get();
			this.settings = migrateSettings(raw);
		}
		this.loaded = true;
	}

	persist(): void {
		const bridge = getBridge();
		if (!bridge) return;
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			void bridge.settings.set($state.snapshot(this.settings));
		}, 250);
	}

	// --- Triggers ---------------------------------------------------------
	addTrigger(trigger: Trigger): void {
		this.settings.triggers.push(trigger);
		this.persist();
	}

	updateTrigger(id: string, patch: Partial<Trigger>): void {
		const t = this.settings.triggers.find((x) => x.id === id);
		if (t) Object.assign(t, patch);
		this.persist();
	}

	removeTrigger(id: string): void {
		this.settings.triggers = this.settings.triggers.filter((x) => x.id !== id);
		this.persist();
	}

	// --- Sounds -----------------------------------------------------------
	addSound(sound: Sound): void {
		this.settings.sounds.push(sound);
		this.persist();
	}

	updateSound(id: string, patch: Partial<Sound>): void {
		const s = this.settings.sounds.find((x) => x.id === id);
		if (s) Object.assign(s, patch);
		this.persist();
	}

	removeSound(id: string): void {
		this.settings.sounds = this.settings.sounds.filter((x) => x.id !== id);
		// Unlink any triggers that pointed at this sound.
		for (const t of this.settings.triggers) if (t.soundId === id) t.soundId = null;
		this.persist();
	}

	// --- General / shortcuts ---------------------------------------------
	setGeneral(patch: Partial<GeneralSettings>): void {
		Object.assign(this.settings.general, patch);
		this.persist();
	}

	setShortcut<K extends keyof Shortcuts>(key: K, value: Shortcuts[K]): void {
		this.settings.shortcuts[key] = value;
		this.persist();
	}
}

export const app = new AppStore();
