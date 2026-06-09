// Unit tests for the feature-extraction + matching logic. Bundled and run via
// scripts/run-matching-test.mjs.
import { scoreTrigger } from '../src/lib/triggers/matcher';
import { faceVector, normalizeHand, cosine } from '../src/lib/triggers/features';
import type { DetectionFrame, FaceData, HandData, HandPoint } from '../src/lib/detection/types';
import type { Trigger } from '../src/lib/types';

let failures = 0;
function assert(cond: boolean, msg: string): void {
	if (cond) {
		console.log('ok  - ' + msg);
	} else {
		failures++;
		console.log('FAIL - ' + msg);
	}
}
const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

function mkTrigger(p: Partial<Trigger>): Trigger {
	return {
		id: 'x', name: 'x', modality: 'face', kind: 'builtin', threshold: 0.5,
		holdMs: 0, cooldownMs: 0, soundId: null, enabled: true, createdAt: 0, ...p
	};
}
const faceData = (bs: Record<string, number>): FaceData => ({ blendshapes: bs });
const frameFace = (bs: Record<string, number>): DetectionFrame => ({ tsMs: 0, face: faceData(bs), hands: [] });

// 21-point synthetic hand
const BASE: number[][] = Array.from({ length: 21 }, (_, i) => [(i % 5) * 0.1, Math.floor(i / 5) * 0.1, i * 0.005]);
function handPts(dx: number, dy: number, scale: number): HandPoint[] {
	return BASE.map((p) => ({ x: p[0] * scale + dx, y: p[1] * scale + dy, z: p[2] * scale }));
}
function hand(gesture: string | null, score = 0.9, tf: [number, number, number] = [0, 0, 1]): HandData {
	return { handedness: 'Right', gesture: gesture ? { name: gesture, score } : null, landmarks: handPts(tf[0], tf[1], tf[2]) };
}

const smileBs = { mouthSmileLeft: 0.9, mouthSmileRight: 0.88, jawOpen: 0.05 };

// --- builtin face ---
const smile = mkTrigger({ builtinId: 'smile', threshold: 0.45 });
assert(scoreTrigger(smile, frameFace(smileBs)) > 0.8, 'builtin smile scores high on a smile');
assert(scoreTrigger(smile, frameFace({})) === 0, 'builtin smile scores 0 on neutral');
assert(scoreTrigger(smile, { tsMs: 0, face: null, hands: [] }) === 0, 'builtin face scores 0 with no face');

// --- builtin hand ---
const thumb = mkTrigger({ modality: 'hand', builtinId: 'thumb-up', threshold: 0.5 });
assert(approx(scoreTrigger(thumb, { tsMs: 0, face: null, hands: [hand('Thumb_Up', 0.8)] }), 0.8), 'builtin hand returns gesture confidence');
assert(scoreTrigger(thumb, { tsMs: 0, face: null, hands: [hand('Victory', 0.9)] }) === 0, 'wrong gesture scores 0');

// --- custom face ---
const sampleVec = faceVector(faceData(smileBs));
const customFace = mkTrigger({ kind: 'custom', samples: [sampleVec], threshold: 0.8 });
assert(scoreTrigger(customFace, frameFace(smileBs)) > 0.99, 'custom face matches identical vector');
assert(scoreTrigger(customFace, frameFace({ mouthFrownLeft: 0.9, mouthFrownRight: 0.9 })) < 0.5, 'custom face low on a different expression');

// --- hand normalization invariance ---
const h1 = hand('Open_Palm');
const h1moved = hand('Open_Palm', 0.9, [0.3, -0.2, 2.5]);
assert(cosine(normalizeHand(h1), normalizeHand(h1moved)) > 0.999, 'hand normalization is translation + scale invariant');

// --- custom hand ---
const customHand = mkTrigger({ modality: 'hand', kind: 'custom', samples: [normalizeHand(h1)], threshold: 0.9 });
assert(scoreTrigger(customHand, { tsMs: 0, face: null, hands: [h1moved] }) > 0.99, 'custom hand matches the same pose moved/scaled');

console.log(failures === 0 ? 'ALL_PASS' : 'FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
