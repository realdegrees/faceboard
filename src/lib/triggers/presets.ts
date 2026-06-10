import type { Modality } from '../types';
import { clamp01 } from './features';

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

const g = (bs: Record<string, number>, n: string): number => bs[n] ?? 0;
const avg = (...xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export const PRESETS: Preset[] = [
	// --- Facial expressions (blendshape rules) ---------------------------
	{ id: 'smile', name: 'Smile', modality: 'face', kind: 'face-rule', defaultThreshold: 0.4,
		score: (bs) => avg(g(bs, 'mouthSmileLeft'), g(bs, 'mouthSmileRight')) },
	{ id: 'mouth-open', name: 'Mouth Open', modality: 'face', kind: 'face-rule', defaultThreshold: 0.5,
		score: (bs) => g(bs, 'jawOpen') },
	{ id: 'surprise', name: 'Surprise', modality: 'face', kind: 'face-rule', defaultThreshold: 0.4,
		score: (bs) => Math.min(g(bs, 'jawOpen'), avg(g(bs, 'browInnerUp'), g(bs, 'browOuterUpLeft'), g(bs, 'browOuterUpRight'))) },
	{ id: 'brows-up', name: 'Eyebrows Raised', modality: 'face', kind: 'face-rule', defaultThreshold: 0.4,
		score: (bs) => avg(g(bs, 'browInnerUp'), g(bs, 'browOuterUpLeft'), g(bs, 'browOuterUpRight')) },
	// Frown reads weakly as mouthFrown alone, so also accept a furrowed brow.
	{ id: 'frown', name: 'Frown', modality: 'face', kind: 'face-rule', defaultThreshold: 0.3,
		score: (bs) => Math.max(avg(g(bs, 'mouthFrownLeft'), g(bs, 'mouthFrownRight')), avg(g(bs, 'browDownLeft'), g(bs, 'browDownRight'))) },
	{ id: 'pucker', name: 'Kiss / Pucker', modality: 'face', kind: 'face-rule', defaultThreshold: 0.45,
		score: (bs) => g(bs, 'mouthPucker') },
	{ id: 'cheek-puff', name: 'Cheek Puff', modality: 'face', kind: 'face-rule', defaultThreshold: 0.4,
		score: (bs) => g(bs, 'cheekPuff') },
	{ id: 'wink-left', name: 'Wink (Left Eye)', modality: 'face', kind: 'face-rule', defaultThreshold: 0.4,
		score: (bs) => g(bs, 'eyeBlinkLeft') * clamp01(1 - g(bs, 'eyeBlinkRight') / 0.5) },
	{ id: 'wink-right', name: 'Wink (Right Eye)', modality: 'face', kind: 'face-rule', defaultThreshold: 0.4,
		score: (bs) => g(bs, 'eyeBlinkRight') * clamp01(1 - g(bs, 'eyeBlinkLeft') / 0.5) },

	// --- Hand signs (builtin MediaPipe gestures) -------------------------
	{ id: 'thumb-up', name: 'Thumbs Up', modality: 'hand', kind: 'hand-gesture', gesture: 'Thumb_Up', defaultThreshold: 0.5 },
	{ id: 'thumb-down', name: 'Thumbs Down', modality: 'hand', kind: 'hand-gesture', gesture: 'Thumb_Down', defaultThreshold: 0.5 },
	{ id: 'victory', name: 'Victory / Peace', modality: 'hand', kind: 'hand-gesture', gesture: 'Victory', defaultThreshold: 0.5 },
	{ id: 'point-up', name: 'Pointing Up', modality: 'hand', kind: 'hand-gesture', gesture: 'Pointing_Up', defaultThreshold: 0.5 },
	{ id: 'fist', name: 'Closed Fist', modality: 'hand', kind: 'hand-gesture', gesture: 'Closed_Fist', defaultThreshold: 0.5 },
	{ id: 'open-palm', name: 'Open Palm', modality: 'hand', kind: 'hand-gesture', gesture: 'Open_Palm', defaultThreshold: 0.5 },
	{ id: 'iloveyou', name: 'I Love You', modality: 'hand', kind: 'hand-gesture', gesture: 'ILoveYou', defaultThreshold: 0.5 }
];

export function getPreset(id?: string): Preset | undefined {
	return id ? PRESETS.find((p) => p.id === id) : undefined;
}

export function presetsByModality(modality: Modality): Preset[] {
	return PRESETS.filter((p) => p.modality === modality);
}
