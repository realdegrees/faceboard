import {
	FilesetResolver,
	FaceLandmarker,
	GestureRecognizer,
	type FaceLandmarkerResult,
	type GestureRecognizerResult
} from '@mediapipe/tasks-vision';
import type { DetectionFrame, FaceData, HandData } from './types';

// All assets are served locally so the running app never hits the network.
const WASM_PATH = '/mediapipe/wasm';
const FACE_MODEL = '/mediapipe/models/face_landmarker.task';
const HAND_MODEL = '/mediapipe/models/gesture_recognizer.task';

export interface ModalityFlags {
	face: boolean;
	hand: boolean;
}

type Vision = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/**
 * Wraps the MediaPipe Face Landmarker (blendshapes) and Gesture Recognizer
 * (hand landmarks + builtin gestures). Tries the GPU delegate first and falls
 * back to CPU if the GPU context can't be created.
 */
export class Detector {
	#vision: Vision | null = null;
	#face: FaceLandmarker | null = null;
	#hand: GestureRecognizer | null = null;
	#delegate: 'GPU' | 'CPU' = 'GPU';

	get delegate(): 'GPU' | 'CPU' {
		return this.#delegate;
	}

	async init(modalities: ModalityFlags): Promise<void> {
		this.#vision ??= await FilesetResolver.forVisionTasks(WASM_PATH);
		if (modalities.face && !this.#face) this.#face = await this.#createFace();
		if (modalities.hand && !this.#hand) this.#hand = await this.#createHand();
	}

	async #createFace(): Promise<FaceLandmarker> {
		try {
			return await FaceLandmarker.createFromOptions(this.#vision!, {
				baseOptions: { modelAssetPath: FACE_MODEL, delegate: this.#delegate },
				outputFaceBlendshapes: true,
				outputFacialTransformationMatrixes: false,
				runningMode: 'VIDEO',
				numFaces: 1,
				// Looser thresholds so faces are picked up in poor lighting / at angles.
				minFaceDetectionConfidence: 0.3,
				minFacePresenceConfidence: 0.3,
				minTrackingConfidence: 0.3
			});
		} catch (err) {
			if (this.#delegate === 'GPU') {
				this.#delegate = 'CPU';
				return this.#createFace();
			}
			throw err;
		}
	}

	async #createHand(): Promise<GestureRecognizer> {
		try {
			return await GestureRecognizer.createFromOptions(this.#vision!, {
				baseOptions: { modelAssetPath: HAND_MODEL, delegate: this.#delegate },
				runningMode: 'VIDEO',
				numHands: 2,
				// Lower so hands are detected before all five fingers are clearly visible
				// and in low light.
				minHandDetectionConfidence: 0.3,
				minHandPresenceConfidence: 0.3,
				minTrackingConfidence: 0.3
			});
		} catch (err) {
			if (this.#delegate === 'GPU') {
				this.#delegate = 'CPU';
				return this.#createHand();
			}
			throw err;
		}
	}

	detect(
		input: HTMLVideoElement | HTMLCanvasElement,
		tsMs: number,
		modalities: ModalityFlags
	): DetectionFrame {
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

function toFace(result: FaceLandmarkerResult): FaceData | null {
	const landmarks = result.faceLandmarks?.[0];
	if (!landmarks || landmarks.length === 0) return null;
	const blendshapes: Record<string, number> = {};
	for (const c of result.faceBlendshapes?.[0]?.categories ?? []) {
		if (c.categoryName) blendshapes[c.categoryName] = c.score;
	}
	return {
		blendshapes,
		landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }))
	};
}

function toHands(result: GestureRecognizerResult): HandData[] {
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
