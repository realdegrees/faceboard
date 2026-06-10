import type { FaceData, HeadPose } from './types';

/**
 * One Euro filter — an adaptive low-pass that removes jitter without adding the
 * lag a fixed low-pass would. The standard cure for MediaPipe's shaky
 * frame-to-frame output (see the 1€ filter, Casiez et al.). One filter per
 * signal; the cutoff rises with speed so fast motion stays responsive while a
 * still face stops shimmering.
 */
class OneEuro {
	#minCutoff: number;
	#beta: number;
	#dCutoff: number;
	#xPrev = 0;
	#dxPrev = 0;
	#tsPrev: number | null = null;
	#started = false;

	constructor(minCutoff: number, beta: number, dCutoff = 1) {
		this.#minCutoff = minCutoff;
		this.#beta = beta;
		this.#dCutoff = dCutoff;
	}

	#alpha(cutoff: number, dt: number): number {
		const tau = 1 / (2 * Math.PI * cutoff);
		return 1 / (1 + tau / dt);
	}

	filter(value: number, tsMs: number): number {
		if (!this.#started) {
			this.#started = true;
			this.#tsPrev = tsMs;
			this.#xPrev = value;
			return value;
		}
		const dt = Math.max((tsMs - (this.#tsPrev ?? tsMs)) / 1000, 1e-3);
		this.#tsPrev = tsMs;
		const dx = (value - this.#xPrev) / dt;
		const edx = this.#dxPrev + this.#alpha(this.#dCutoff, dt) * (dx - this.#dxPrev);
		this.#dxPrev = edx;
		const cutoff = this.#minCutoff + this.#beta * Math.abs(edx);
		const x = this.#xPrev + this.#alpha(cutoff, dt) * (value - this.#xPrev);
		this.#xPrev = x;
		return x;
	}
}

// Blendshapes and head-pose angles live on very different scales, so they get
// their own tunings. Both favour a clean, stable signal while staying quick
// enough for live triggering.
const BS_MIN_CUTOFF = 1.4;
const BS_BETA = 0.45;
const POSE_MIN_CUTOFF = 1.2;
const POSE_BETA = 0.06;

/**
 * Smooths a face's blendshapes + head pose across frames (stateful — one per
 * detection stream). Landmarks are left raw; the overlay already runs smoothly
 * and smoothing 478 points would only add latency to the mesh.
 */
export class FaceSmoother {
	#bs = new Map<string, OneEuro>();
	#yaw = new OneEuro(POSE_MIN_CUTOFF, POSE_BETA);
	#pitch = new OneEuro(POSE_MIN_CUTOFF, POSE_BETA);
	#roll = new OneEuro(POSE_MIN_CUTOFF, POSE_BETA);

	/** Reset state — call when detection stops or the stream changes. */
	reset(): void {
		this.#bs.clear();
		this.#yaw = new OneEuro(POSE_MIN_CUTOFF, POSE_BETA);
		this.#pitch = new OneEuro(POSE_MIN_CUTOFF, POSE_BETA);
		this.#roll = new OneEuro(POSE_MIN_CUTOFF, POSE_BETA);
	}

	apply(face: FaceData, tsMs: number): FaceData {
		const blendshapes: Record<string, number> = {};
		for (const name in face.blendshapes) {
			let f = this.#bs.get(name);
			if (!f) {
				f = new OneEuro(BS_MIN_CUTOFF, BS_BETA);
				this.#bs.set(name, f);
			}
			blendshapes[name] = f.filter(face.blendshapes[name], tsMs);
		}
		let headPose: HeadPose | null | undefined = face.headPose;
		if (face.headPose) {
			headPose = {
				yaw: this.#yaw.filter(face.headPose.yaw, tsMs),
				pitch: this.#pitch.filter(face.headPose.pitch, tsMs),
				roll: this.#roll.filter(face.headPose.roll, tsMs)
			};
		}
		return { blendshapes, landmarks: face.landmarks, headPose };
	}
}
