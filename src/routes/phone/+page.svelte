<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Signaling } from '$lib/phone/signaling';

	type Status = 'init' | 'connecting' | 'ready' | 'streaming' | 'denied' | 'error';

	let status = $state<Status>('init');
	let error = $state('');
	let facingMode = $state<'user' | 'environment'>('environment');
	let videoEl = $state<HTMLVideoElement>();

	let sig: Signaling | null = null;
	let pc: RTCPeerConnection | null = null;
	let stream: MediaStream | null = null;
	let sender: RTCRtpSender | null = null;

	interface RtcSignal {
		type: 'offer' | 'answer' | 'candidate' | 'control';
		sdp?: RTCSessionDescriptionInit;
		candidate?: RTCIceCandidateInit;
		action?: string;
	}

	onMount(() => {
		const token = new URLSearchParams(location.search).get('token') ?? '';
		sig = new Signaling();
		sig.onDenied = () => (status = 'denied');
		sig.onReady = () => (status = 'ready');
		sig.onPeerJoined = () => void startStreaming();
		sig.onSignal = async (raw) => {
			const p = raw as RtcSignal;
			if (p.type === 'control') {
				if (p.action === 'flip') void flip();
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

		return cleanup;
	});

	async function startStreaming() {
		try {
			if (!stream) {
				stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
				if (videoEl) {
					videoEl.srcObject = stream;
					void videoEl.play().catch(() => {});
				}
			}
			pc = new RTCPeerConnection({ iceServers: [] });
			pc.onicecandidate = (e) => {
				if (e.candidate) sig?.send({ type: 'candidate', candidate: e.candidate.toJSON() });
			};
			pc.onconnectionstatechange = () => {
				if (pc?.connectionState === 'connected') status = 'streaming';
			};
			for (const track of stream.getTracks()) sender = pc.addTrack(track, stream);
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			sig?.send({ type: 'offer', sdp: pc.localDescription ?? undefined });
		} catch (e) {
			status = 'error';
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function flip() {
		facingMode = facingMode === 'user' ? 'environment' : 'user';
		try {
			const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
			const track = next.getVideoTracks()[0];
			if (sender) await sender.replaceTrack(track);
			stream?.getTracks().forEach((t) => t.stop());
			stream = next;
			if (videoEl) videoEl.srcObject = stream;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function cleanup() {
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
			streaming: 'Streaming to Faceboard',
			denied: 'Pairing rejected — reopen the link from the app',
			error: 'Error'
		}[status]
	);
</script>

<main class="relative flex min-h-screen flex-col bg-bg">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={videoEl}
		class="absolute inset-0 h-full w-full object-cover"
		style="transform: {facingMode === 'user' ? 'scaleX(-1)' : 'none'}"
		muted
		playsinline
		autoplay
	></video>

	<div class="relative z-10 mt-auto flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent p-5 pt-12">
		<div class="flex items-center gap-2">
			<span
				class="inline-block h-2 w-2 rounded-full {status === 'streaming'
					? 'bg-accent'
					: status === 'error' || status === 'denied'
						? 'bg-red-500'
						: 'bg-white/70'}"
				style={status !== 'streaming' && status !== 'error' && status !== 'denied'
					? 'animation: fb-pulse 1.4s ease-in-out infinite;'
					: ''}
			></span>
			<div>
				<p class="text-[14px] font-medium text-white">{statusText}</p>
				{#if error}<p class="text-[11px] text-red-300">{error}</p>{/if}
			</div>
		</div>
		<button
			onclick={flip}
			class="rounded-full border border-white/25 bg-black/40 px-4 py-2 text-[13px] text-white backdrop-blur transition-colors hover:bg-black/60"
		>
			Flip camera
		</button>
	</div>
</main>
