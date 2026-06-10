// Unit tests for the feature-extraction + matching logic. Bundled and run via
// scripts/run-matching-test.mjs.
import { scoreTrigger } from '../src/lib/triggers/matcher';
import {
	faceVector,
	expressionScore,
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
import type { DetectionFrame, FaceData, HandData, HandPoint, HeadPose } from '../src/lib/detection/types';
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
const faceData = (bs: Record<string, number>, headPose?: HeadPose): FaceData => ({ blendshapes: bs, landmarks: [], headPose });
const frameFace = (bs: Record<string, number>, headPose?: HeadPose): DetectionFrame => ({ tsMs: 0, face: faceData(bs, headPose), hands: [] });

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

// --- rotation-invariant hand pose ---
const poseBase = handWith('Right', [0, 0, 1]);
const rotTrig = mkTrigger({ modality: 'hand', kind: 'custom', motion: 'static', hands: 1, rotationInvariant: true, samples: [normalizeStaticPose([poseBase])], threshold: 0.85 });
const rotated: HandData = { ...poseBase, landmarks: poseBase.landmarks.map((p) => ({ ...p, x: -p.x, y: -p.y })) };
assert(scoreTrigger(rotTrig, { tsMs: 0, face: null, hands: [rotated] }) > 0.95, 'rotation-invariant pose matches a 180°-rotated hand');
const fixedTrig = mkTrigger({ modality: 'hand', kind: 'custom', motion: 'static', hands: 1, samples: [normalizeStaticPose([poseBase])], threshold: 0.85 });
assert(scoreTrigger(fixedTrig, { tsMs: 0, face: null, hands: [rotated] }) < scoreTrigger(rotTrig, { tsMs: 0, face: null, hands: [rotated] }), 'a fixed pose is more orientation-sensitive than a rotation-invariant one');

// --- custom hand (static, 1 hand) ---
const customHand = mkTrigger({ modality: 'hand', kind: 'custom', motion: 'static', hands: 1, samples: [normalizeStaticPose([h1])], threshold: 0.9 });
assert(scoreTrigger(customHand, { tsMs: 0, face: null, hands: [h1moved] }) > 0.99, 'custom 1-hand pose matches the same pose moved/scaled');

// --- pose discrimination: a "point" must NOT match an open palm (real bug) ---
// 21 MediaPipe landmarks: 0 wrist, thumb 1-4, index 5-8, middle 9-12, ring 13-16, pinky 17-20.
function handFrom(pts: number[][]): HandData {
	return { handedness: 'Right', gesture: null, landmarks: pts.map((p) => ({ x: p[0], y: p[1], z: p[2] ?? 0, visibility: 1 })) };
}
const PALM = handFrom([
	[0.5, 0.95, 0], [0.42, 0.88, 0], [0.36, 0.82, 0], [0.31, 0.77, 0], [0.27, 0.73, 0],
	[0.46, 0.72, 0], [0.45, 0.58, 0], [0.44, 0.48, 0], [0.43, 0.4, 0],
	[0.51, 0.7, 0], [0.51, 0.55, 0], [0.51, 0.44, 0], [0.51, 0.35, 0],
	[0.56, 0.71, 0], [0.57, 0.57, 0], [0.58, 0.47, 0], [0.59, 0.39, 0],
	[0.61, 0.74, 0], [0.63, 0.62, 0], [0.64, 0.54, 0], [0.65, 0.48, 0]
]);
const POINT = handFrom([
	[0.5, 0.95, 0], [0.42, 0.88, 0], [0.36, 0.82, 0], [0.31, 0.77, 0], [0.27, 0.73, 0],
	[0.46, 0.72, 0], [0.45, 0.58, 0], [0.44, 0.48, 0], [0.43, 0.4, 0],
	[0.51, 0.7, 0], [0.51, 0.58, 0], [0.51, 0.66, 0], [0.51, 0.71, 0],
	[0.56, 0.71, 0], [0.57, 0.6, 0], [0.57, 0.66, 0], [0.56, 0.71, 0],
	[0.61, 0.74, 0], [0.62, 0.63, 0], [0.62, 0.69, 0], [0.61, 0.73, 0]
]);
const pointTrig = mkTrigger({ modality: 'hand', kind: 'custom', motion: 'static', hands: 1, samples: [normalizeStaticPose([POINT])], threshold: 0.9 });
const pointSelf = scoreTrigger(pointTrig, { tsMs: 0, face: null, hands: [POINT] });
const pointVsPalm = scoreTrigger(pointTrig, { tsMs: 0, face: null, hands: [PALM] });
console.log('  [pose] point-vs-point=' + pointSelf.toFixed(3) + ' point-vs-palm=' + pointVsPalm.toFixed(3));
assert(pointSelf > 0.95, 'point pose matches itself');
assert(pointVsPalm < 0.8, 'point pose scores well below threshold for an open palm (was >0.9 with cosine)');

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

// --- neutral-relative expression matching ---
// Resting face already has a slight smile; the captured expression is a big smile.
const neutralBs = { mouthSmileLeft: 0.1, mouthSmileRight: 0.1 };
const neutral = faceVector(faceData(neutralBs));
const bigSmile = { mouthSmileLeft: 0.85, mouthSmileRight: 0.8 };
const smileTarget = faceVector(faceData(bigSmile));

// expressionScore unit behaviour
assert(expressionScore(faceData(bigSmile), smileTarget, neutral, undefined, false) > 0.9, 'identical expression (delta) matches');
assert(expressionScore(faceData(neutralBs), smileTarget, neutral, undefined, false) < 0.2, 'resting face does NOT match (neutral subtracted)');
assert(expressionScore(faceData({ mouthSmileLeft: 0.5, mouthSmileRight: 0.45 }), smileTarget, neutral, undefined, false) > 0.7, 'a softer smile still matches (intensity-invariant)');
assert(expressionScore(faceData({ mouthFrownLeft: 0.8, mouthFrownRight: 0.8 }), smileTarget, neutral, undefined, false) < 0.3, 'a different expression (frown) scores low');

// via scoreTrigger
const smileTrig = mkTrigger({ modality: 'face', kind: 'custom', target: smileTarget, neutral, threshold: 0.6 });
assert(scoreTrigger(smileTrig, frameFace(bigSmile)) > 0.9, 'face trigger matches the captured expression');
assert(scoreTrigger(smileTrig, frameFace(neutralBs)) < 0.6, 'face trigger does not fire on the resting face');

// open mouth must NOT fire on a closed smile (real bug) — jawOpen is the signature
const openTarget = faceVector(faceData({ jawOpen: 0.85, mouthFunnel: 0.35 }));
const openTrig = mkTrigger({ modality: 'face', kind: 'custom', target: openTarget, neutral, threshold: 0.55 });
assert(scoreTrigger(openTrig, frameFace({ jawOpen: 0.8, mouthFunnel: 0.3 })) > 0.85, 'open mouth matches an open mouth');
assert(
	scoreTrigger(openTrig, frameFace({ mouthSmileLeft: 0.85, mouthSmileRight: 0.85, cheekSquintLeft: 0.4, cheekSquintRight: 0.4, jawOpen: 0.12 })) < 0.5,
	'open mouth does NOT fire on a closed smile'
);

// --- head pose toggle ---
const poseFwd: HeadPose = { yaw: 2, pitch: 5, roll: 0 };
const poseLeft: HeadPose = { yaw: 32, pitch: 5, roll: 0 };
assert(scoreTrigger(smileTrig, frameFace(bigSmile, poseLeft)) > 0.9, 'head-pose-off trigger ignores head direction');

const smileLeftTrig = mkTrigger({ modality: 'face', kind: 'custom', target: smileTarget, neutral, headPose: poseLeft, useHeadPose: true, threshold: 0.6 });
assert(scoreTrigger(smileLeftTrig, frameFace(bigSmile, poseLeft)) > 0.85, 'head-pose trigger matches expression + matching head direction');
assert(scoreTrigger(smileLeftTrig, frameFace(bigSmile, poseFwd)) < 0.6, 'head-pose trigger fails when head direction is wrong');

// pure head-pose trigger (look left, neutral expression)
const lookLeftTrig = mkTrigger({ modality: 'face', kind: 'custom', target: neutral, neutral, headPose: poseLeft, useHeadPose: true, threshold: 0.6 });
assert(scoreTrigger(lookLeftTrig, frameFace(neutralBs, poseLeft)) > 0.85, 'pure head-pose trigger fires on the captured head direction');
assert(scoreTrigger(lookLeftTrig, frameFace(neutralBs, poseFwd)) < 0.5, 'pure head-pose trigger does not fire facing forward');

console.log(failures === 0 ? 'ALL_PASS' : 'FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
