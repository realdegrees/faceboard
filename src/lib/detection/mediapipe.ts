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
				numFaces: 1
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
				numHands: 2
			});
		} catch (err) {
			if (this.#delegate === 'GPU') {
				this.#delegate = 'CPU';
				return this.#createHand();
			}
			throw err;
		}
	}

	detect(video: HTMLVideoElement, tsMs: number): DetectionFrame {
		let face: FaceData | null = null;
		let hands: HandData[] = [];
		if (this.#face) face = toFace(this.#face.detectForVideo(video, tsMs));
		if (this.#hand) hands = toHands(this.#hand.recognizeForVideo(video, tsMs));
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
	const categories = result.faceBlendshapes?.[0]?.categories;
	if (!categories || categories.length === 0) return null;
	const blendshapes: Record<string, number> = {};
	for (const c of categories) {
		if (c.categoryName) blendshapes[c.categoryName] = c.score;
	}
	return { blendshapes };
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
			landmarks: result.landmarks[i].map((p) => ({ x: p.x, y: p.y, z: p.z }))
		});
	}
	return hands;
}
