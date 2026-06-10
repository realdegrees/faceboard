<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Signaling } from '$lib/phone/signaling';

	type Status = 'init' | 'connecting' | 'ready' | 'streaming' | 'denied' | 'error';

	let status = $state<Status>('init');
	let error = $state('');
	let facing = $state<'user' | 'environment'>('user');
	let remoteRotation = $state(0);
	let orientation = $state<'portrait' | 'landscape'>('portrait');
	let selfVideo = $state<HTMLVideoElement>();
	let host = $state('');

	let sig: Signaling | null = null;
	let pc: RTCPeerConnection | null = null;
	let stream: MediaStream | null = null;
	let sender: RTCRtpSender | null = null;

	interface Msg {
		type: string;
		sdp?: RTCSessionDescriptionInit;
		candidate?: RTCIceCandidateInit;
		rotation?: number;
	}

	/** Reliable front/back switch: facingMode exact, then fall back to enumerating
	 *  devices (Android often ignores a plain facingMode hint). */
	async function getCameraStream(f: 'user' | 'environment'): Promise<MediaStream> {
		try {
			return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: f } }, audio: false });
		} catch {
			const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
			const re = f === 'environment' ? /back|rear|environment/i : /front|user|face/i;
			const dev = devices.find((d) => re.test(d.label)) ?? devices[f === 'environment' ? devices.length - 1 : 0];
			if (!dev) return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			return navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: dev.deviceId } }, audio: false });
		}
	}

	function sendMeta() {
		sig?.send({ type: 'meta', facing, orientation });
	}
	function detectOrientation() {
		orientation = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
		sendMeta();
	}
	function attachSelf() {
		if (selfVideo && stream) {
			selfVideo.srcObject = stream;
			void selfVideo.play().catch(() => {});
		}
	}

	onMount(() => {
		host = location.host;
		const token = new URLSearchParams(location.search).get('token') ?? '';
		sig = new Signaling();
		sig.onDenied = () => (status = 'denied');
		sig.onReady = () => (status = 'ready');
		sig.onPeerJoined = () => void startStreaming();
		sig.onSignal = async (raw) => {
			const p = raw as Msg;
			if (p.type === 'flip') {
				void flip();
				return;
			}
			if (p.type === 'meta') {
				if (typeof p.rotation === 'number') remoteRotation = p.rotation;
				return;
			}
			if (!pc) return;
			if (p.type === 'answer' && p.sdp) await pc.setRemoteDescription(p.sdp);
			else if (p.type === 'candidate' && p.candidate) {
				try {
					await pc.addIceCandidate(p.candidate);
				} catch {
					/* ignore */
				}
			}
		};
		sig
			.connect(`wss://${location.host}`, 'guest', token)
			.then(() => {
				if (status === 'init') status = 'connecting';
			})
			.catch((e) => {
				status = 'error';
				error = String(e);
			});
		window.addEventListener('orientationchange', detectOrientation);
		window.addEventListener('resize', detectOrientation);
		detectOrientation();
		return cleanup;
	});

	async function startStreaming() {
		try {
			if (!stream) {
				stream = await getCameraStream(facing);
				attachSelf();
			}
			pc = new RTCPeerConnection({ iceServers: [] });
			pc.onicecandidate = (e) => {
				if (e.candidate) sig?.send({ type: 'candidate', candidate: e.candidate.toJSON() });
			};
			pc.onconnectionstatechange = () => {
				if (pc?.connectionState === 'connected') status = 'streaming';
			};
			for (const t of stream.getTracks()) sender = pc.addTrack(t, stream);
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			sig?.send({ type: 'offer', sdp: pc.localDescription ?? undefined });
			sendMeta();
		} catch (e) {
			status = 'error';
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function flip() {
		facing = facing === 'user' ? 'environment' : 'user';
		try {
			const next = await getCameraStream(facing);
			const track = next.getVideoTracks()[0];
			if (sender) await sender.replaceTrack(track);
			stream?.getTracks().forEach((t) => t.stop());
			stream = next;
			attachSelf();
			sendMeta();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function requestRotate() {
		sig?.send({ type: 'rotate' });
	}

	function cleanup() {
		window.removeEventListener('orientationchange', detectOrientation);
		window.removeEventListener('resize', detectOrientation);
		stream?.getTracks().forEach((t) => t.stop());
		pc?.close();
		sig?.close();
	}
	onDestroy(cleanup);

	const statusText = $derived(
		{
			init: 'Connecting…',
			connecting: 'Pairing…',
			ready: 'Waiting for desktop…',
			streaming: 'Streaming to your computer',
			denied: 'Pairing rejected — reopen the link from the app',
			error: 'Error'
		}[status]
	);
	const live = $derived(status === 'streaming');
	const bad = $derived(status === 'error' || status === 'denied');
</script>

<main class="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-6">
	<header class="flex items-center gap-2.5">
		<span
			class="inline-block h-2.5 w-2.5 rounded-full {live ? 'bg-accent' : bad ? 'bg-red-500' : 'bg-white/60'}"
			style={!live && !bad ? 'animation: fb-pulse 1.4s ease-in-out infinite;' : ''}
		></span>
		<h1 class="text-lg font-semibold">Faceboard Camera</h1>
	</header>

	<div class="mx-auto aspect-video w-44 overflow-hidden rounded-xl border border-border bg-surface-2">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={selfVideo} class="h-full w-full object-cover" muted playsinline autoplay></video>
	</div>

	<div class="rounded-card border border-border bg-surface-1 px-4 py-2 text-[13px]">
		<div class="flex items-center justify-between border-b border-border py-2">
			<span class="text-faint">Status</span><span class="text-text">{statusText}</span>
		</div>
		<div class="flex items-center justify-between border-b border-border py-2">
			<span class="text-faint">Connected to</span><span class="truncate pl-3 text-text">{host}</span>
		</div>
		<div class="flex items-center justify-between border-b border-border py-2">
			<span class="text-faint">Camera</span><span class="text-text">{facing === 'user' ? 'Front' : 'Back'}</span>
		</div>
		<div class="flex items-center justify-between border-b border-border py-2">
			<span class="text-faint">Orientation</span><span class="text-text capitalize">{orientation}</span>
		</div>
		<div class="flex items-center justify-between py-2">
			<span class="text-faint">Desktop rotation</span><span class="text-text">{remoteRotation}°</span>
		</div>
		{#if error}<p class="pb-2 text-[12px] text-red-400">{error}</p>{/if}
	</div>

	<div class="grid grid-cols-2 gap-3">
		<button onclick={flip} class="rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-[14px] text-text transition-colors active:bg-surface-3">
			Flip camera
		</button>
		<button onclick={requestRotate} class="rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-[14px] text-text transition-colors active:bg-surface-3">
			Rotate 90°
		</button>
	</div>

	<p class="mt-auto text-center text-[12px] text-faint">
		Keep this page open — your camera streams to Faceboard on your computer over your local network.
	</p>
</main>
