import type { Modality } from '../types';

export interface FacePreset {
	id: string;
	name: string;
	modality: 'face';
	kind: 'face-rule';
	/** Maps a blendshape map to an activation score in [0,1]. */
	score: (bs: Record<string, number>) => number;
	defaultThreshold: number;
}

export interface HandPreset {
	id: string;
	name: string;
	modality: 'hand';
	kind: 'hand-gesture';
	/** Builtin MediaPipe gesture category name. */
	gesture: string;
	defaultThreshold: number;
}

export type Preset = FacePreset | HandPreset;

// Facial expressions are user-recorded only (region-weighted single capture), so
// there are no face presets — just the builtin MediaPipe hand signs.
export const PRESETS: Preset[] = [
	{ id: 'thumb-up', name: 'Thumbs Up', modality: 'hand', kind: 'hand-gesture', gesture: 'Thumb_Up', defaultThreshold: 0.5 },
	{ id: 'thumb-down', name: 'Thumbs Down', modality: 'hand', kind: 'hand-gesture', gesture: 'Thumb_Down', defaultThreshold: 0.5 },
	{ id: 'victory', name: 'Victory / Peace', modality: 'hand', kind: 'hand-gesture', gesture: 'Victory', defaultThreshold: 0.5 },
	{ id: 'point-up', name: 'Pointing Up', modality: 'hand', kind: 'hand-gesture', gesture: 'Pointing_Up', defaultThreshold: 0.5 },
	{ id: 'fist', name: 'Closed Fist', modality: 'hand', kind: 'hand-gesture', gesture: 'Closed_Fist', defaultThreshold: 0.5 },
	{ id: 'open-palm', name: 'Open Palm', modality: 'hand', kind: 'hand-gesture', gesture: 'Open_Palm', defaultThreshold: 0.5 }
];

export function getPreset(id?: string): Preset | undefined {
	return id ? PRESETS.find((p) => p.id === id) : undefined;
}

export function presetsByModality(modality: Modality): Preset[] {
	return PRESETS.filter((p) => p.modality === modality);
}
