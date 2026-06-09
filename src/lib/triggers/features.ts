import { BLENDSHAPE_NAMES, type FaceData, type HandData } from '../detection/types';

export function clamp01(x: number): number {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Stable ordered blendshape feature vector (51 dims, excludes _neutral). */
export function faceVector(face: FaceData): number[] {
	return BLENDSHAPE_NAMES.map((n) => face.blendshapes[n] ?? 0);
}

/** Subtract a neutral baseline, clamping negatives to zero. */
export function subtractNeutral(v: number[], neutral?: number[]): number[] {
	if (!neutral) return v.slice();
	return v.map((x, i) => Math.max(0, x - (neutral[i] ?? 0)));
}

/**
 * Translation + scale invariant hand feature vector. Landmarks are recentred on
 * the wrist and scaled by the wrist->middle-MCP bone length. Orientation is
 * intentionally preserved so e.g. thumbs-up and thumbs-down stay distinct.
 */
export function normalizeHand(hand: HandData): number[] {
	const lm = hand.landmarks;
	const wrist = lm[0];
	const ref =
		Math.hypot(lm[9].x - wrist.x, lm[9].y - wrist.y, lm[9].z - wrist.z) || 1e-6;
	const out: number[] = [];
	for (const p of lm) {
		out.push((p.x - wrist.x) / ref, (p.y - wrist.y) / ref, (p.z - wrist.z) / ref);
	}
	return out;
}

export function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Nearest-neighbour similarity: best cosine over all captured samples. */
export function bestCosine(cur: number[], samples: number[][]): number {
	let best = 0;
	for (const s of samples) {
		const c = cosine(cur, s);
		if (c > best) best = c;
	}
	return best;
}
