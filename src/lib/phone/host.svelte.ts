import { FaceLandmarker, GestureRecognizer } from '@mediapipe/tasks-vision';
import { getBridge, type LanInfo } from '$lib/bridge';
import { engine } from '$lib/detection/engine.svelte';
import { app } from '$lib/stores/app.svelte';
import { neededModalities } from '$lib/triggers/runtime.svelte';
import { Signaling } from './signaling';

// Flattened mesh/skeleton connections sent once to the phone so it can draw the
// overlay without loading MediaPipe.
const FACE_CONNS = FaceLandmarker.FACE_LANDMARKS_TESSELATION.flatMap((c) => [c.start, c.end]);
const HAND_CONNS = GestureRecognizer.HAND_CONNECTIONS.flatMap((c) => [c.start, c.end]);

export type HostState = 'idle' | 'starting' | 'waiting' | 'connecting' | 'connected' | 'error';

interface RtcSignal {
	type: 'offer' | 'answer' | 'candidate' | 'flip' | 'rotate' | 'meta';
	sdp?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
	facing?: 'user' | 'environment';
	orientation?: 'portrait' | 'landscape';
	rotation?: number;
}

/**
 * Desktop side of the phone-as-webcam link. Starts the LAN server, waits for the
 * phone to pair, answers its WebRTC offer, and feeds the received MediaStream
 * into the detection engine (LAN-only ICE — no STUN/TURN).
 */
class PhoneHost {
	state = $state<HostState>('idle');
	error = $state<string | null>(null);
	info = $state<LanInfo | null>(null);
	/** Reported by the phone for display. */
	peerFacing = $state<'user' | 'environment' | null>(null);
	peerOrientation = $state<'portrait' | 'landscape' | null>(null);

	#sig: Signaling | null = null;
	#pc: RTCPeerConnection | null = null;
	#dc: RTCDataChannel | null = null;
	#overlayTimer: ReturnType<typeof setInterval> | null = null;
	#pingTimer: ReturnType<typeof setInterval> | null = null;

	async start(): Promise<void> {
		const bridge = getBridge();
		if (!bridge) return;
		this.state = 'starting';
		this.error = null;
		try {
			const lan = await bridge.lan.start();
			this.info = lan;
			this.#sig = new Signaling();
			this.#sig.onPeerJoined = () => {
				this.state = 'connecting';
			};
			this.#sig.onPeerLeft = () => {
				this.#teardownPc();
				this.state = 'waiting';
			};
			this.#sig.onSignal = (p) => void this.#onSignal(p as RtcSignal);
			this.#sig.onClose = () => {
				if (this.state !== 'idle') this.state = 'error';
			};
			await this.#sig.connect(lan.signalUrl, 'host', lan.token);
			this.state = 'waiting';
			// Heartbeat so the phone can detect a dropped desktop quickly.
			this.#pingTimer = setInterval(() => this.#sig?.send({ type: 'ping' }), 2000);
		} catch (err) {
			this.state = 'error';
			this.error = err instanceof Error ? err.message : String(err);
		}
	}

	#ensurePc(): RTCPeerConnection {
		if (this.#pc) return this.#pc;
		const pc = new RTCPeerConnection({ iceServers: [] });
		pc.onicecandidate = (e) => {
			if (e.candidate) this.#sig?.send({ type: 'candidate', candidate: e.candidate.toJSON() });
		};
		pc.ontrack = (e) => {
			this.state = 'connected';
			engine.modalities = neededModalities(app.settings.triggers);
			void engine.useExternalStream(e.streams[0]);
			getBridge()?.detection.notifyState(true);
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed') {
				this.#teardownPc();
				this.state = 'waiting';
			}
		};
		// The phone opens an "overlay" data channel; we stream landmarks to it so
		// the phone can draw the same mesh/skeleton the desktop sees.
		pc.ondatachannel = (e) => {
			this.#dc = e.channel;
			this.#dc.onopen = () => this.#startOverlay();
		};
		this.#pc = pc;
		return pc;
	}

	#startOverlay(): void {
		if (!this.#dc) return;
		try {
			this.#dc.send(JSON.stringify({ t: 'conns', fc: FACE_CONNS, hc: HAND_CONNS }));
		} catch {
			/* ignore */
		}
		if (this.#overlayTimer) clearInterval(this.#overlayTimer);
		const r = (v: number) => Math.round(v * 1000) / 1000;
		this.#overlayTimer = setInterval(() => {
			if (!this.#dc || this.#dc.readyState !== 'open') return;
			const f = engine.face?.landmarks ? engine.face.landmarks.flatMap((p) => [r(p.x), r(p.y)]) : [];
			const h = engine.hands.map((hd) => hd.landmarks.flatMap((p) => [r(p.x), r(p.y)]));
			try {
				this.#dc.send(JSON.stringify({ t: 'lm', f, h }));
			} catch {
				/* ignore */
			}
		}, 66);
	}

	async #onSignal(signal: RtcSignal): Promise<void> {
		// Control + metadata messages from the phone.
		if (signal.type === 'meta') {
			if (signal.facing) this.peerFacing = signal.facing;
			if (signal.orientation) this.peerOrientation = signal.orientation;
			return;
		}
		if (signal.type === 'rotate') {
			this.rotate();
			return;
		}

		const pc = this.#ensurePc();
		if (signal.type === 'offer' && signal.sdp) {
			await pc.setRemoteDescription(signal.sdp);
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			this.#sig?.send({ type: 'answer', sdp: pc.localDescription ?? undefined });
			this.#sig?.send({ type: 'meta', rotation: engine.rotation });
		} else if (signal.type === 'candidate' && signal.candidate) {
			try {
				await pc.addIceCandidate(signal.candidate);
			} catch {
				/* ignore late candidates */
			}
		}
	}

	/** Ask the paired phone to switch between its front and back camera. */
	flipCamera(): void {
		this.#sig?.send({ type: 'flip' });
	}

	/** Rotate the desktop preview + detection 90° and tell the phone (display). */
	rotate(): void {
		engine.rotation = (engine.rotation + 90) % 360;
		this.#sig?.send({ type: 'meta', rotation: engine.rotation });
	}

	#teardownPc(): void {
		if (this.#overlayTimer) clearInterval(this.#overlayTimer);
		this.#overlayTimer = null;
		this.#dc?.close();
		this.#dc = null;
		this.#pc?.close();
		this.#pc = null;
	}

	async stop(): Promise<void> {
		if (this.#pingTimer) clearInterval(this.#pingTimer);
		this.#pingTimer = null;
		this.#teardownPc();
		this.#sig?.close();
		this.#sig = null;
		if (engine.active) engine.stop();
		getBridge()?.detection.notifyState(false);
		await getBridge()?.lan.stop();
		this.info = null;
		this.state = 'idle';
	}
}

export const phoneHost = new PhoneHost();
