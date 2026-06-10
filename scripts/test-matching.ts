// Unit tests for the feature-extraction + matching logic. Bundled and run via
// scripts/run-matching-test.mjs.
import { scoreTrigger } from '../src/lib/triggers/matcher';
import {
	faceVector,
	normalizeHand,
	cosine,
	orderHands,
	normalizeStaticPose,
	handsFrameVector,
	normalizeSequence,
	resampleSequence,
	dtw,
	toTemplate,
	DYN_LEN
} from '../src/lib/triggers/features';
import { regionMatch, getRegion, suggestRegions } from '../src/lib/triggers/regions';
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

// --- custom hand (static, 1 hand) ---
const customHand = mkTrigger({ modality: 'hand', kind: 'custom', motion: 'static', hands: 1, samples: [normalizeStaticPose([h1])], threshold: 0.9 });
assert(scoreTrigger(customHand, { tsMs: 0, face: null, hands: [h1moved] }) > 0.99, 'custom 1-hand pose matches the same pose moved/scaled');

// --- orderHands ---
function handWith(handedness: string, tf: [number, number, number]): HandData {
	return { handedness, gesture: null, landmarks: handPts(tf[0], tf[1], tf[2]) };
}
const L = handWith('Left', [0.1, 0, 1]);
const R = handWith('Right', [0.6, 0, 1]);
assert(orderHands([R, L], 2)?.[0].handedness === 'Left', 'orderHands puts Left first');
assert(orderHands([L], 2) === null, 'orderHands needs 2 hands for count 2');

// --- static 2-hand pose (both hands transformed together) ---
const twoHand = mkTrigger({ modality: 'hand', kind: 'custom', motion: 'static', hands: 2, samples: [normalizeStaticPose([L, R])], threshold: 0.9 });
const Lm = handWith('Left', [0.4, 0.3, 2]); // L under translate (0.2,0.3) + scale 2
const Rm = handWith('Right', [1.4, 0.3, 2]); // R under the same transform
assert(scoreTrigger(twoHand, { tsMs: 0, face: null, hands: [Rm, Lm] }) > 0.95, 'custom 2-hand pose matches when both hands move together');
assert(scoreTrigger(twoHand, { tsMs: 0, face: null, hands: [Lm] }) === 0, '2-hand pose scores 0 with one hand');

// --- resample + DTW (dynamic gestures) ---
assert(resampleSequence([[0], [1], [2], [3]], 8).length === 8, 'resampleSequence hits target length');
function moveSeq(fromX: number, toX: number, frames: number): number[][] {
	const out: number[][] = [];
	for (let i = 0; i < frames; i++) {
		const x = fromX + (toX - fromX) * (i / (frames - 1));
		out.push(handsFrameVector([handWith('Right', [x, 0, 1])]));
	}
	return out;
}
const tmpl = toTemplate(moveSeq(0.2, 0.8, 30));
assert(tmpl.length === DYN_LEN, 'template resampled to DYN_LEN');
assert(dtw(tmpl, tmpl) < 1e-6, 'dtw of identical sequences is ~0');
const dSame = dtw(tmpl, toTemplate(moveSeq(0.35, 0.95, 18))); // same path, shifted + different speed
const dRev = dtw(tmpl, toTemplate(moveSeq(0.8, 0.2, 24))); // reversed motion
assert(dSame < dRev, 'dtw: same motion closer than reversed motion');
assert(dSame < 0.15, 'dtw: position-shifted + speed-varied motion is a strong match');

// --- face region-weighted single-capture matching ---
const kissBrows = faceVector(faceData({ mouthPucker: 0.85, browOuterUpLeft: 0.7, browDownRight: 0.7 }));
const mouthRegion = getRegion('mouth')!;
assert(regionMatch(kissBrows, kissBrows, mouthRegion) > 0.99, 'regionMatch: identical mouth region = 1');
assert(regionMatch(faceVector(faceData({})), kissBrows, mouthRegion) < 0.5, 'regionMatch: neutral vs kiss mouth is low');

const suggested = suggestRegions(kissBrows);
assert(
	suggested.includes('mouth') && suggested.includes('brow-left') && suggested.includes('brow-right'),
	'suggestRegions picks mouth + both brows'
);
assert(!suggested.includes('cheeks'), 'suggestRegions ignores inactive cheeks');

const faceTrig = mkTrigger({ modality: 'face', kind: 'custom', target: kissBrows, regions: ['brow-left', 'brow-right', 'mouth'], threshold: 0.7 });
assert(scoreTrigger(faceTrig, frameFace({ mouthPucker: 0.85, browOuterUpLeft: 0.7, browDownRight: 0.7 })) > 0.85, 'face region trigger matches the captured expression');
assert(scoreTrigger(faceTrig, frameFace({ mouthPucker: 0.85, browOuterUpLeft: 0.7 })) < 0.7, 'face region trigger fails when one selected region (right brow) is off');

const mouthOnly = mkTrigger({ modality: 'face', kind: 'custom', target: faceVector(faceData({ mouthPucker: 0.85 })), regions: ['mouth'], threshold: 0.7 });
assert(scoreTrigger(mouthOnly, frameFace({ mouthPucker: 0.85, browDownLeft: 0.9 })) > 0.85, 'unselected regions (brows) are ignored');

console.log(failures === 0 ? 'ALL_PASS' : 'FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
