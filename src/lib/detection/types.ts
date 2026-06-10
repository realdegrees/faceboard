// Shapes produced by the detection pipeline, consumed by the matching engine.

export interface Point {
	x: number;
	y: number;
	z: number;
	/** Present so the array is assignable to MediaPipe's NormalizedLandmark[]. */
	visibility: number;
}

/** Back-compat alias. */
export type HandPoint = Point;

export interface FaceData {
	/** ARKit-style blendshape name -> coefficient in [0,1]. ~52 entries. */
	blendshapes: Record<string, number>;
	/** 478 face-mesh landmarks (normalized image space) for the preview overlay. */
	landmarks: Point[];
}

export interface HandData {
	/** 'Left' | 'Right' as reported by MediaPipe (mirror of the camera view). */
	handedness: string;
	/** Top builtin gesture for this hand, if any (e.g. Thumb_Up). 'None' filtered out. */
	gesture: { name: string; score: number } | null;
	/** 21 normalized landmarks in image space. */
	landmarks: HandPoint[];
}

export interface DetectionFrame {
	tsMs: number;
	face: FaceData | null;
	hands: HandData[];
}

/**
 * Canonical blendshape order. Used to turn the blendshape map into a stable
 * feature vector for similarity matching, independent of MediaPipe's category
 * ordering. The leading `_neutral` is intentionally excluded from features.
 */
export const BLENDSHAPE_NAMES: string[] = [
	'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
	'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
	'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft',
	'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
	'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
	'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
	'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
	'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft',
	'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper',
	'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft',
	'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight'
];
