import { BLENDSHAPE_NAMES } from '../detection/types';

/**
 * Face regions group blendshapes anatomically. A custom face expression is one
 * captured target plus a set of selected regions; it matches when the current
 * face is close to the target on *every* selected region (others are ignored).
 */
export interface FaceRegion {
	id: string;
	label: string;
	blendshapes: string[];
}

export const FACE_REGIONS: FaceRegion[] = [
	{ id: 'brow-left', label: 'Left brow', blendshapes: ['browDownLeft', 'browOuterUpLeft', 'browInnerUp'] },
	{ id: 'brow-right', label: 'Right brow', blendshapes: ['browDownRight', 'browOuterUpRight', 'browInnerUp'] },
	{ id: 'eye-left', label: 'Left eye', blendshapes: ['eyeBlinkLeft', 'eyeSquintLeft', 'eyeWideLeft'] },
	{ id: 'eye-right', label: 'Right eye', blendshapes: ['eyeBlinkRight', 'eyeSquintRight', 'eyeWideRight'] },
	{ id: 'cheeks', label: 'Cheeks', blendshapes: ['cheekPuff', 'cheekSquintLeft', 'cheekSquintRight'] },
	{ id: 'nose', label: 'Nose', blendshapes: ['noseSneerLeft', 'noseSneerRight'] },
	{
		id: 'mouth',
		label: 'Mouth',
		blendshapes: [
			'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight',
			'mouthFrownLeft', 'mouthFrownRight', 'mouthLeft', 'mouthRight', 'mouthRollLower', 'mouthRollUpper',
			'mouthShrugLower', 'mouthShrugUpper', 'mouthPressLeft', 'mouthPressRight', 'mouthDimpleLeft',
			'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthLowerDownLeft',
			'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight'
		]
	},
	{ id: 'jaw', label: 'Jaw', blendshapes: ['jawForward', 'jawLeft', 'jawRight'] }
];

export const BLENDSHAPE_INDEX: Record<string, number> = Object.fromEntries(
	BLENDSHAPE_NAMES.map((n, i) => [n, i])
);

export function getRegion(id: string): FaceRegion | undefined {
	return FACE_REGIONS.find((r) => r.id === id);
}

/**
 * Match score in [0,1] of the current face against the captured target over a
 * region's blendshapes. Differences are weighted by how active each blendshape
 * is (in either the target or the current frame), so the muscles that define the
 * expression dominate and incidental near-zero shapes are ignored — but extra
 * activation that isn't in the target is also penalised.
 */
export function regionMatch(cur: number[], target: number[], region: FaceRegion): number {
	let num = 0;
	let den = 0;
	for (const name of region.blendshapes) {
		const i = BLENDSHAPE_INDEX[name];
		if (i === undefined) continue;
		const t = target[i] ?? 0;
		const c = cur[i] ?? 0;
		const w = Math.max(t, c);
		num += w * Math.abs(c - t);
		den += w;
	}
	// Region is neutral in both target and current → it matches (nothing to enforce).
	if (den < 1e-6) return 1;
	const s = 1 - num / den;
	return s < 0 ? 0 : s > 1 ? 1 : s;
}

/** Peak activation of a captured target within a region (for auto-suggesting). */
export function regionActivation(target: number[], region: FaceRegion): number {
	let max = 0;
	for (const name of region.blendshapes) {
		const i = BLENDSHAPE_INDEX[name];
		if (i !== undefined) max = Math.max(max, target[i] ?? 0);
	}
	return max;
}

/** Regions a captured expression visibly activates — sensible defaults to weight. */
export function suggestRegions(target: number[], threshold = 0.22): string[] {
	return FACE_REGIONS.filter((r) => regionActivation(target, r) >= threshold).map((r) => r.id);
}
