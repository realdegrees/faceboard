import { BLENDSHAPE_NAMES, type FaceData, type HeadPose, type HandData } from '../detection/types';

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

/** Distance between two head poses in degrees (tilt weighted a little less than
 *  turn/nod, since it's the least deliberate axis). */
export function headPoseDistance(a: HeadPose, b: HeadPose): number {
	const dy = a.yaw - b.yaw;
	const dp = a.pitch - b.pitch;
	const dr = (a.roll - b.roll) * 0.7;
	return Math.sqrt(dy * dy + dp * dp + dr * dr);
}

// Tunables for expression matching.
const EXPR_FLOOR = 0.12; // min target delta magnitude to count as a real expression
const STRENGTH_FRAC = 0.55; // fraction of the captured strength needed for full score
const POSE_TOL_DEG = 22; // head-pose match tolerance

/**
 * Neutral-relative expression match in [0,1], with an optional head-pose gate.
 *
 * Every *defining* ("signature") muscle of the captured expression — the
 * blendshapes that moved most vs neutral — must be activated to roughly
 * STRENGTH_FRAC of its captured level; the score is the weakest of those. This is
 * what makes it discriminate: an "open mouth" is defined by jawOpen, so a closed
 * smile (no jawOpen) can't match it, while a *softer* version of the right
 * expression still does (intensity-invariant). Everything is relative to the
 * user's own neutral, so lighting/face-shape differences fall out.
 */
export function expressionScore(
	face: FaceData,
	target: number[],
	neutral: number[] | undefined | null,
	headPoseTarget: HeadPose | undefined,
	useHeadPose: boolean
): number {
	const cur = faceVector(face);
	const n = neutral ?? [];
	const liveDelta: number[] = [];
	const targetDelta: number[] = [];
	let maxT = 0;
	for (let i = 0; i < target.length; i++) {
		liveDelta.push(Math.max(0, (cur[i] ?? 0) - (n[i] ?? 0)));
		const t = Math.max(0, target[i] - (n[i] ?? 0));
		targetDelta.push(t);
		if (t > maxT) maxT = t;
	}
	const hasExpression = maxT >= EXPR_FLOOR;

	let exprScore: number;
	if (!hasExpression) {
		exprScore = 1; // no real expression captured -> a pure head-pose trigger
	} else {
		const sigCut = Math.max(EXPR_FLOOR, 0.5 * maxT); // a muscle is "defining" if this active
		let recall = 1;
		let any = false;
		for (let i = 0; i < targetDelta.length; i++) {
			if (targetDelta[i] < sigCut) continue;
			any = true;
			const got = clamp01(liveDelta[i] / (STRENGTH_FRAC * targetDelta[i]));
			if (got < recall) recall = got;
		}
		exprScore = any ? recall : 0;
	}

	if (useHeadPose && headPoseTarget) {
		if (!face.headPose) return 0;
		const poseScore = clamp01(1 - headPoseDistance(face.headPose, headPoseTarget) / POSE_TOL_DEG);
		return clamp01(Math.min(exprScore, poseScore));
	}
	// A capture with neither a real expression nor a head-pose requirement matches
	// any face — reject it rather than fire constantly.
	if (!hasExpression) return 0;
	return clamp01(exprScore);
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

/** Root-mean-square per-coordinate deviation between two equal-length vectors. */
export function rmsd(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	if (n === 0) return Infinity;
	let ss = 0;
	for (let i = 0; i < n; i++) {
		const d = a[i] - b[i];
		ss += d * d;
	}
	return Math.sqrt(ss / n);
}

// Maps RMSD (on unit-RMS-normalised pose / pairwise-descriptor vectors) to a
// [0,1] score. Tuned so a near-identical pose scores ~1 while a clearly different
// hand shape (e.g. a point vs an open palm) drops well below typical thresholds.
const POSE_DIST_SCALE = 1.25;

/**
 * Best pose-match score over captured samples, using per-point distance rather
 * than cosine. Cosine is dominated by the points farthest from the hand centroid
 * (wrist, extended fingers), so folded fingers — exactly what distinguishes a
 * "point" from an open palm — barely register. RMSD weights every landmark
 * equally, so finger configuration actually discriminates.
 */
export function bestPoseScore(cur: number[], samples: number[][]): number {
	let best = 0;
	for (const s of samples) {
		const score = clamp01(1 - rmsd(cur, s) / POSE_DIST_SCALE);
		if (score > best) best = score;
	}
	return best;
}

// --- Two-hand pose helpers -------------------------------------------------

/** Order detected hands into stable slots: Left then Right (fallback by wrist x).
 *  Returns null if fewer than `count` hands are present. */
export function orderHands(hands: HandData[], count: 1 | 2): HandData[] | null {
	if (count === 1) return hands.length ? [hands[0]] : null;
	if (hands.length < 2) return null;
	const left = hands.find((h) => h.handedness === 'Left');
	const right = hands.find((h) => h.handedness === 'Right');
	if (left && right && left !== right) return [left, right];
	const sorted = [...hands].sort((a, b) => a.landmarks[0].x - b.landmarks[0].x);
	return [sorted[0], sorted[1]];
}

/** Static-pose vector: centroid-centred + RMS-scaled over all involved hands.
 *  Position/scale invariant; orientation and inter-hand geometry preserved. */
export function normalizeStaticPose(hands: HandData[]): number[] {
	const pts: [number, number, number][] = [];
	for (const h of hands) for (const p of h.landmarks) pts.push([p.x, p.y, p.z]);
	const n = pts.length || 1;
	const c: [number, number, number] = [0, 0, 0];
	for (const p of pts) {
		c[0] += p[0];
		c[1] += p[1];
		c[2] += p[2];
	}
	c[0] /= n;
	c[1] /= n;
	c[2] /= n;
	let ss = 0;
	for (const p of pts) ss += (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
	const scale = Math.sqrt(ss / n) || 1e-6;
	const out: number[] = [];
	for (const p of pts) out.push((p[0] - c[0]) / scale, (p[1] - c[1]) / scale, (p[2] - c[2]) / scale);
	return out;
}

/**
 * Rotation/translation invariant pose descriptor: the set of pairwise distances
 * between all landmarks. Two poses that differ only by orientation (upside down,
 * backwards) produce the same descriptor. Input is a flat 3D point list.
 */
export function pairwiseDescriptor(points: number[]): number[] {
	const n = Math.floor(points.length / 3);
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const ix = points[i * 3];
		const iy = points[i * 3 + 1];
		const iz = points[i * 3 + 2];
		for (let j = i + 1; j < n; j++) {
			const dx = ix - points[j * 3];
			const dy = iy - points[j * 3 + 1];
			const dz = iz - points[j * 3 + 2];
			out.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
		}
	}
	return out;
}

/** Mirror a flat point list across X (left hand <-> right hand chirality). */
export function mirrorX(flat: number[]): number[] {
	const out = flat.slice();
	for (let i = 0; i < out.length; i += 3) out[i] = -out[i];
	return out;
}
