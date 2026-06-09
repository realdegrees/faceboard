// Core data model shared across the renderer. The Electron side persists this as
// an opaque JSON document — the schema lives here, in the renderer.

export type Modality = 'face' | 'hand';
export type TriggerKind = 'builtin' | 'custom';

export interface Trigger {
	id: string;
	name: string;
	modality: Modality;
	kind: TriggerKind;
	/** For builtin triggers: references a preset definition by id. */
	builtinId?: string;
	/** For custom triggers: few-shot captured, normalized feature vectors. */
	samples?: number[][];
	/** Optional neutral baseline subtracted before matching. */
	neutral?: number[];
	/** Match score threshold in [0,1] — higher is stricter. */
	threshold: number;
	/** Match must be sustained this long (ms) before the sound fires. */
	holdMs: number;
	/** Minimum gap (ms) between consecutive fires of this trigger. */
	cooldownMs: number;
	/** Linked sound id, or null if unlinked. */
	soundId: string | null;
	enabled: boolean;
	createdAt: number;
}

export interface Sound {
	id: string;
	label: string;
	/** Absolute path on disk. */
	path: string;
	/** Playback volume in [0,1]. */
	volume: number;
	createdAt: number;
}

export interface Shortcuts {
	/** Electron accelerator string, or null if unbound. */
	toggleDetection: string | null;
}

export type CameraSource = 'local' | 'phone';

export interface GeneralSettings {
	cameraDeviceId: string | null;
	source: CameraSource;
	/** Detection loop target rate. */
	detectionFps: number;
	mirror: boolean;
	startMinimized: boolean;
	autostartDetection: boolean;
	/** Global multiplier applied to match scores (0.5..1.5). */
	sensitivity: number;
}

export interface FaceboardSettings {
	version: number;
	triggers: Trigger[];
	sounds: Sound[];
	shortcuts: Shortcuts;
	general: GeneralSettings;
}

export const SETTINGS_VERSION = 1;

export function defaultSettings(): FaceboardSettings {
	return {
		version: SETTINGS_VERSION,
		triggers: [],
		sounds: [],
		shortcuts: { toggleDetection: 'CommandOrControl+Shift+D' },
		general: {
			cameraDeviceId: null,
			source: 'local',
			detectionFps: 18,
			mirror: true,
			startMinimized: false,
			autostartDetection: false,
			sensitivity: 1
		}
	};
}

/** Coerce an unknown persisted document into a valid settings object. */
export function migrateSettings(raw: unknown): FaceboardSettings {
	const base = defaultSettings();
	if (!raw || typeof raw !== 'object') return base;
	const r = raw as Partial<FaceboardSettings>;
	return {
		version: SETTINGS_VERSION,
		triggers: Array.isArray(r.triggers) ? r.triggers : base.triggers,
		sounds: Array.isArray(r.sounds) ? r.sounds : base.sounds,
		shortcuts: { ...base.shortcuts, ...(r.shortcuts ?? {}) },
		general: { ...base.general, ...(r.general ?? {}) }
	};
}

export function newId(): string {
	return crypto.randomUUID();
}
