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

function norm(v: number[]): number {
	let s = 0;
	for (const x of v) s += x * x;
	return Math.sqrt(s);
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
 * Neutral-relative expression match in [0,1]. The score is the *pattern* match
 * (cosine of the activation delta vs neutral — which auto-weights by whatever
 * muscles actually moved when captured) times the *strength* (how hard the
 * expression is made), with an optional head-pose gate. A pure head-pose capture
 * (no expression) scores on head pose alone. Lighting/face-shape differences fall
 * out because everything is relative to the user's own neutral.
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
	const liveDelta = cur.map((v, i) => Math.max(0, v - (n[i] ?? 0)));
	const targetDelta = target.map((v, i) => Math.max(0, v - (n[i] ?? 0)));
	const targetMag = norm(targetDelta);

	let exprScore: number;
	if (targetMag < EXPR_FLOOR) {
		exprScore = 1; // no real expression captured -> a pure head-pose trigger
	} else {
		const liveMag = norm(liveDelta);
		const strength = clamp01(liveMag / targetMag / STRENGTH_FRAC);
		exprScore = clamp01(cosine(liveDelta, targetDelta) * strength);
	}

	if (useHeadPose && headPoseTarget) {
		if (!face.headPose) return 0;
		const poseScore = clamp01(1 - headPoseDistance(face.headPose, headPoseTarget) / POSE_TOL_DEG);
		return clamp01(Math.min(exprScore, poseScore));
	}
	// A capture with neither a real expression nor a head-pose requirement matches
	// any face — reject it rather than fire constantly.
	if (targetMag < EXPR_FLOOR) return 0;
	return exprScore;
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

// --- Two-hand + dynamic gesture helpers ------------------------------------

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

/** Raw image-space landmark vector for the given hands (used per-frame in motion
 *  sequences, where absolute position carries the gesture). */
export function handsFrameVector(hands: HandData[]): number[] {
	const out: number[] = [];
	for (const h of hands) for (const p of h.landmarks) out.push(p.x, p.y, p.z);
	return out;
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

/** Swap the two hands in a 2-hand (42-point) flat list. */
export function swapHands(flat: number[]): number[] {
	if (flat.length < 126) return flat.slice();
	return [...flat.slice(63, 126), ...flat.slice(0, 63), ...flat.slice(126)];
}

/** Frames a dynamic gesture template/window is resampled to. */
export const DYN_LEN = 24;

/** Mean-centre (per axis) + global-scale a whole motion sequence so the gesture
 *  is position/scale invariant while the relative motion + shape is preserved. */
export function normalizeSequence(seq: number[][]): number[][] {
	if (!seq.length) return seq;
	const mean = [0, 0, 0];
	const cnt = [0, 0, 0];
	for (const f of seq)
		for (let i = 0; i < f.length; i++) {
			const a = i % 3;
			mean[a] += f[i];
			cnt[a]++;
		}
	for (let a = 0; a < 3; a++) mean[a] /= cnt[a] || 1;
	let ss = 0;
	let sc = 0;
	for (const f of seq)
		for (let i = 0; i < f.length; i++) {
			ss += (f[i] - mean[i % 3]) ** 2;
			sc++;
		}
	const scale = Math.sqrt(ss / (sc || 1)) || 1e-6;
	return seq.map((f) => f.map((v, i) => (v - mean[i % 3]) / scale));
}

/** Linear-interpolate a sequence to a fixed length. */
export function resampleSequence(seq: number[][], length: number): number[][] {
	if (seq.length === 0) return [];
	if (seq.length === 1) return Array.from({ length }, () => seq[0].slice());
	const out: number[][] = [];
	for (let i = 0; i < length; i++) {
		const t = (i / (length - 1)) * (seq.length - 1);
		const lo = Math.floor(t);
		const hi = Math.min(lo + 1, seq.length - 1);
		const frac = t - lo;
		const a = seq[lo];
		const b = seq[hi];
		out.push(a.map((v, j) => v + (b[j] - v) * frac));
	}
	return out;
}

/** DTW distance between two equal-dim sequences, normalized by path length. */
export function dtw(a: number[][], b: number[][]): number {
	const n = a.length;
	const m = b.length;
	if (!n || !m) return Infinity;
	let prev = new Array(m + 1).fill(Infinity);
	prev[0] = 0;
	for (let i = 1; i <= n; i++) {
		const cur = new Array(m + 1).fill(Infinity);
		const fa = a[i - 1];
		for (let j = 1; j <= m; j++) {
			const fb = b[j - 1];
			let s = 0;
			const d = Math.min(fa.length, fb.length);
			for (let k = 0; k < d; k++) {
				const e = fa[k] - fb[k];
				s += e * e;
			}
			cur[j] = Math.sqrt(s) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
		}
		prev = cur;
	}
	return prev[m] / (n + m);
}

/** Map a normalized DTW distance to a [0,1] match score. */
export function dynamicScore(dist: number): number {
	return clamp01(1 - dist / 0.7);
}

/** Turn a recorded take into a stored template (normalized + resampled). */
export function toTemplate(rawSeq: number[][]): number[][] {
	return resampleSequence(normalizeSequence(rawSeq), DYN_LEN);
}
