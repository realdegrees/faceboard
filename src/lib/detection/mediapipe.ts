import {
	FilesetResolver,
	FaceLandmarker,
	GestureRecognizer,
	type FaceLandmarkerResult,
	type GestureRecognizerResult
} from '@mediapipe/tasks-vision';
import type { DetectionFrame, FaceData, HandData, HeadPose } from './types';

// All assets are served locally so the running app never hits the network.
export const WASM_PATH = '/mediapipe/wasm';
export const FACE_MODEL = '/mediapipe/models/face_landmarker.task';
export const HAND_MODEL = '/mediapipe/models/gesture_recognizer.task';

export interface ModalityFlags {
	face: boolean;
	hand: boolean;
}

export type Delegate = 'GPU' | 'CPU';
export type Vision = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

// Looser thresholds so faces/hands are picked up in poor lighting, at angles, and
// before all five fingers are clearly visible.
export function createFaceLandmarker(vision: Vision, delegate: Delegate): Promise<FaceLandmarker> {
	return FaceLandmarker.createFromOptions(vision, {
		baseOptions: { modelAssetPath: FACE_MODEL, delegate },
		outputFaceBlendshapes: true,
		// Needed for head pose (yaw/pitch/roll) — "looking left", tilt, etc.
		outputFacialTransformationMatrixes: true,
		runningMode: 'VIDEO',
		numFaces: 1,
		minFaceDetectionConfidence: 0.3,
		minFacePresenceConfidence: 0.3,
		minTrackingConfidence: 0.3
	});
}

export function createGestureRecognizer(vision: Vision, delegate: Delegate): Promise<GestureRecognizer> {
	return GestureRecognizer.createFromOptions(vision, {
		baseOptions: { modelAssetPath: HAND_MODEL, delegate },
		runningMode: 'VIDEO',
		numHands: 2,
		minHandDetectionConfidence: 0.3,
		minHandPresenceConfidence: 0.3,
		minTrackingConfidence: 0.3
	});
}

export function toFace(result: FaceLandmarkerResult): FaceData | null {
	const landmarks = result.faceLandmarks?.[0];
	if (!landmarks || landmarks.length === 0) return null;
	const blendshapes: Record<string, number> = {};
	for (const c of result.faceBlendshapes?.[0]?.categories ?? []) {
		if (c.categoryName) blendshapes[c.categoryName] = c.score;
	}
	return {
		blendshapes,
		landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 })),
		headPose: headPoseFromMatrix(result.facialTransformationMatrixes?.[0]?.data)
	};
}

const RAD2DEG = 180 / Math.PI;

/** Decompose the 4×4 (column-major) facial transformation matrix into head-pose
 *  Euler angles in degrees. yaw = left/right, pitch = up/down, roll = tilt. */
function headPoseFromMatrix(data: number[] | Float32Array | undefined): HeadPose | null {
	if (!data || data.length < 11) return null;
	// Column-major: element(row r, col c) = data[c*4 + r].
	const r00 = data[0],
		r10 = data[1],
		r20 = data[2],
		r21 = data[6],
		r22 = data[10];
	const pitch = Math.atan2(r21, r22) * RAD2DEG;
	const yaw = Math.atan2(-r20, Math.hypot(r21, r22)) * RAD2DEG;
	const roll = Math.atan2(r10, r00) * RAD2DEG;
	return { yaw, pitch, roll };
}

export function toHands(result: GestureRecognizerResult): HandData[] {
	const hands: HandData[] = [];
	for (let i = 0; i < result.landmarks.length; i++) {
		const top = result.gestures?.[i]?.[0];
		const gesture =
			top && top.categoryName && top.categoryName !== 'None'
				? { name: top.categoryName, score: top.score }
				: null;
		hands.push({
			handedness: result.handedness?.[i]?.[0]?.categoryName ?? 'Unknown',
			gesture,
			landmarks: result.landmarks[i].map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }))
		});
	}
	return hands;
}

type ImageInput = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

/**
 * Synchronous main-thread detector. Used only as a fallback when the off-thread
 * worker can't be created (the worker path is preferred so inference never blocks
 * the UI). Tries the GPU delegate first, falling back to CPU.
 */
export class Detector {
	#vision: Vision | null = null;
	#face: FaceLandmarker | null = null;
	#hand: GestureRecognizer | null = null;
	#delegate: Delegate = 'GPU';

	get delegate(): Delegate {
		return this.#delegate;
	}

	async init(modalities: ModalityFlags, prefer: Delegate = 'GPU'): Promise<void> {
		// CPU is chosen up front when WebGL is a software rasterizer (where the
		// "GPU" path is slower than CPU/XNNPACK).
		if (!this.#face && !this.#hand) this.#delegate = prefer;
		this.#vision ??= await FilesetResolver.forVisionTasks(WASM_PATH);
		try {
			if (modalities.face && !this.#face) this.#face = await createFaceLandmarker(this.#vision, this.#delegate);
			if (modalities.hand && !this.#hand) this.#hand = await createGestureRecognizer(this.#vision, this.#delegate);
		} catch (err) {
			if (this.#delegate === 'GPU') {
				this.#delegate = 'CPU';
				this.#face?.close();
				this.#hand?.close();
				this.#face = null;
				this.#hand = null;
				return this.init(modalities);
			}
			throw err;
		}
	}

	detect(input: ImageInput, tsMs: number, modalities: ModalityFlags): DetectionFrame {
		let face: FaceData | null = null;
		let hands: HandData[] = [];
		if (this.#face && modalities.face) face = toFace(this.#face.detectForVideo(input, tsMs));
		if (this.#hand && modalities.hand) hands = toHands(this.#hand.recognizeForVideo(input, tsMs));
		return { tsMs, face, hands };
	}

	close(): void {
		this.#face?.close();
		this.#hand?.close();
		this.#face = null;
		this.#hand = null;
	}
}
