import { FilesetResolver, FaceLandmarker, GestureRecognizer } from '@mediapipe/tasks-vision';
import {
	WASM_PATH,
	createFaceLandmarker,
	createGestureRecognizer,
	toFace,
	toHands,
	type Delegate,
	type ModalityFlags,
	type Vision
} from './mediapipe';
import type { FaceData, HandData } from './types';

// Runs the face + hand graphs off the main thread. The host transfers an
// ImageBitmap per frame; we run both detectors on it and post the landmarks
// back. Keeping inference here means the UI thread never blocks on it.

let vision: Vision | null = null;
let face: FaceLandmarker | null = null;
let hand: GestureRecognizer | null = null;
let delegate: Delegate = 'GPU';

type InMsg =
	| { type: 'init'; modalities: ModalityFlags; delegate: Delegate }
	| { type: 'frame'; bitmap: ImageBitmap; ts: number; modalities: ModalityFlags };

type OutMsg =
	| { type: 'ready'; delegate: Delegate }
	| { type: 'error'; error: string }
	| { type: 'result'; ts: number; face: FaceData | null; hands: HandData[] };

// Typed loosely to avoid pulling in the WebWorker lib (which conflicts with the
// project's DOM lib over the `self` global).
const ctx = self as unknown as {
	postMessage: (m: OutMsg) => void;
	onmessage: ((e: MessageEvent<InMsg>) => void) | null;
};
const post = (m: OutMsg) => ctx.postMessage(m);

async function build(modalities: ModalityFlags): Promise<void> {
	if (modalities.face && !face) face = await createFaceLandmarker(vision!, delegate);
	if (modalities.hand && !hand) hand = await createGestureRecognizer(vision!, delegate);
}

async function init(modalities: ModalityFlags, prefer: Delegate): Promise<void> {
	// On the first init pick the host-chosen delegate (CPU when WebGL is a software
	// rasterizer — there CPU/XNNPACK is several times faster than software "GPU").
	if (!face && !hand) delegate = prefer;
	vision ??= await FilesetResolver.forVisionTasks(WASM_PATH);
	try {
		await build(modalities);
	} catch (err) {
		// Retry once on CPU if the GPU delegate can't be created in this worker.
		if (delegate === 'GPU') {
			delegate = 'CPU';
			face?.close();
			hand?.close();
			face = null;
			hand = null;
			await build(modalities);
		} else {
			throw err;
		}
	}
}

ctx.onmessage = async (e: MessageEvent<InMsg>) => {
	const msg = e.data;
	if (msg.type === 'init') {
		try {
			await init(msg.modalities, msg.delegate);
			post({ type: 'ready', delegate });
		} catch (err) {
			post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
		}
		return;
	}
	// frame
	const { bitmap, ts, modalities } = msg;
	let f: FaceData | null = null;
	let h: HandData[] = [];
	try {
		if (face && modalities.face) f = toFace(face.detectForVideo(bitmap, ts));
		if (hand && modalities.hand) h = toHands(hand.recognizeForVideo(bitmap, ts));
	} catch {
		/* drop this frame's results */
	} finally {
		bitmap.close();
	}
	post({ type: 'result', ts, face: f, hands: h });
};
