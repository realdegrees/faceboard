import { getBridge, type LanInfo } from '$lib/bridge';
import { engine } from '$lib/detection/engine.svelte';
import { app } from '$lib/stores/app.svelte';
import { neededModalities } from '$lib/triggers/runtime.svelte';
import { Signaling } from './signaling';

export type HostState = 'idle' | 'starting' | 'waiting' | 'connecting' | 'connected' | 'error';

interface RtcSignal {
	type: 'offer' | 'answer' | 'candidate';
	sdp?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
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

	#sig: Signaling | null = null;
	#pc: RTCPeerConnection | null = null;

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
		this.#pc = pc;
		return pc;
	}

	async #onSignal(signal: RtcSignal): Promise<void> {
		const pc = this.#ensurePc();
		if (signal.type === 'offer' && signal.sdp) {
			await pc.setRemoteDescription(signal.sdp);
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			this.#sig?.send({ type: 'answer', sdp: pc.localDescription ?? undefined });
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
		this.#sig?.send({ type: 'control', action: 'flip' });
	}

	#teardownPc(): void {
		this.#pc?.close();
		this.#pc = null;
	}

	async stop(): Promise<void> {
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
