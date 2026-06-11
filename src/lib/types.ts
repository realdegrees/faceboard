// Core data model shared across the renderer. The Electron side persists this as
// an opaque JSON document — the schema lives here, in the renderer.

import type { HeadPose } from './detection/types';

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
	/** Custom face: captured expression blendshape vector (absolute). Matched as a
	 *  delta from `neutral`. */
	target?: number[];
	/** Custom face: head orientation captured with the expression. Only matched
	 *  when `useHeadPose` is on (e.g. "look left", tilt). */
	headPose?: HeadPose;
	/** Custom face: also require the captured head direction, not just the
	 *  expression. Off by default — the expression matches at any head angle. */
	useHeadPose?: boolean;
	/** @deprecated region-weighted model — superseded by neutral-delta matching. */
	regions?: string[];
	/** @deprecated mesh editor — superseded by neutral-delta matching. */
	meshLandmarks?: number[];
	/** Hand triggers: number of hands the trigger uses (default 1). */
	hands?: 1 | 2;
	/** Hand poses: match the pose regardless of hand orientation (upside down etc.). */
	rotationInvariant?: boolean;
	/** Hand triggers: also match the other hand (1-hand) / swapped hands (2-hand). */
	eitherHand?: boolean;
	/** Match score threshold in [0,1] — higher is stricter. */
	threshold: number;
	/** Match must be sustained this long (ms) before the sound fires. */
	holdMs: number;
	/** Minimum gap (ms) between consecutive fires / re-arm delay after release. */
	cooldownMs: number;
	/** 'once' = fire once per detection, re-arm only after the pose is released for
	 *  cooldownMs. 'while-held' = repeat every cooldownMs while held. Default 'once'. */
	retrigger?: 'once' | 'while-held';
	/** 'once' = play the sound once on fire. 'while-active' = start the sound when
	 *  the trigger goes active and stop it when it ends (looping). Default 'once'. */
	playback?: 'once' | 'while-active';
	/** Playback volume in [0,1] for this trigger's sound (default 1). */
	volume?: number;
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
	/** Hide to the tray (keep detecting) instead of quitting when the window closes. */
	closeToTray: boolean;
	/** Global multiplier applied to match scores (0.5..1.5). */
	sensitivity: number;
	/** Calibrated neutral (resting) face: blendshape baseline subtracted before
	 *  expression matching. Captured once; reused by every expression trigger. */
	faceNeutral?: number[] | null;
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
			detectionFps: 30,
			mirror: true,
			startMinimized: false,
			autostartDetection: false,
			closeToTray: true,
			sensitivity: 1
		}
	};
}

/** A legacy dynamic (moving) hand gesture from before that feature was removed.
 *  Such triggers stored motion templates instead of a static pose, so they can no
 *  longer match — drop them on load rather than render a broken card. */
function isLegacyDynamic(t: unknown): boolean {
	const r = t as { motion?: unknown; sequences?: unknown } | null;
	return !!r && (r.motion === 'dynamic' || Array.isArray(r.sequences));
}

/** Coerce an unknown persisted document into a valid settings object. */
export function migrateSettings(raw: unknown): FaceboardSettings {
	const base = defaultSettings();
	if (!raw || typeof raw !== 'object') return base;
	const r = raw as Partial<FaceboardSettings>;
	return {
		version: SETTINGS_VERSION,
		triggers: Array.isArray(r.triggers) ? r.triggers.filter((t) => !isLegacyDynamic(t)) : base.triggers,
		sounds: Array.isArray(r.sounds) ? r.sounds : base.sounds,
		shortcuts: { ...base.shortcuts, ...(r.shortcuts ?? {}) },
		general: { ...base.general, ...(r.general ?? {}) }
	};
}

export function newId(): string {
	return crypto.randomUUID();
}
