<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Signaling } from '$lib/phone/signaling';

	type Status = 'init' | 'connecting' | 'ready' | 'streaming' | 'denied' | 'error';

	let status = $state<Status>('init');
	let error = $state('');
	let lost = $state(false);
	let facing = $state<'user' | 'environment'>('user');
	let remoteRotation = $state(0);
	let orientation = $state<'portrait' | 'landscape'>('portrait');
	let host = $state('');
	let selfVideo = $state<HTMLVideoElement>();
	let overlayCanvas = $state<HTMLCanvasElement>();
	let aspect = $state(3 / 4);
	// Collapsed by default to a compact 16:9 strip so the status + controls stay on
	// screen; tap the preview to expand it to the camera's native aspect.
	let expanded = $state(false);

	let sig: Signaling | null = null;
	let pc: RTCPeerConnection | null = null;
	let dc: RTCDataChannel | null = null;
	let stream: MediaStream | null = null;
	let sender: RTCRtpSender | null = null;
	let watchdog: ReturnType<typeof setTimeout> | null = null;

	let faceConns: number[] = [];
	let handConns: number[] = [];
	let faceLm: number[] = [];
	let handsLm: number[][] = [];

	interface Msg {
		type: string;
		sdp?: RTCSessionDescriptionInit;
		candidate?: RTCIceCandidateInit;
		rotation?: number;
	}

	function bumpWatchdog() {
		if (watchdog) clearTimeout(watchdog);
		watchdog = setTimeout(() => (lost = true), 6000);
	}

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
		sig.onPeerLeft = () => (lost = true);
		sig.onClose = () => (lost = true);
		sig.onPeerJoined = () => {
			lost = false;
			void startStreaming();
		};
		sig.onSignal = async (raw) => {
			bumpWatchdog();
			lost = false;
			const p = raw as Msg;
			if (p.type === 'ping') return;
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
				bumpWatchdog();
			})
			.catch((e) => {
				status = 'error';
				error = String(e);
			});
		window.addEventListener('orientationchange', detectOrientation);
		window.addEventListener('resize', detectOrientation);
		detectOrientation();
		requestAnimationFrame(drawOverlay);
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
				const s = pc?.connectionState;
				if (s === 'connected') {
					status = 'streaming';
					lost = false;
				} else if (s === 'failed' || s === 'disconnected') {
					lost = true;
				}
			};
			dc = pc.createDataChannel('overlay');
			dc.onmessage = (e) => {
				const m = JSON.parse(e.data);
				if (m.t === 'conns') {
					faceConns = m.fc;
					handConns = m.hc;
				} else if (m.t === 'lm') {
					faceLm = m.f;
					handsLm = m.h;
				}
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

	function drawOverlay() {
		requestAnimationFrame(drawOverlay);
		const v = selfVideo;
		const c = overlayCanvas;
		if (!v || !c || !v.videoWidth) return;
		const w = (c.width = v.videoWidth);
		const h = (c.height = v.videoHeight);
		if (Math.abs(aspect - w / h) > 1e-3) aspect = w / h;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, w, h);
		if (lost) return;
		if (faceLm.length && faceConns.length) {
			ctx.strokeStyle = 'rgba(124,199,255,0.4)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let i = 0; i < faceConns.length; i += 2) {
				const a = faceConns[i];
				const b = faceConns[i + 1];
				ctx.moveTo(faceLm[a * 2] * w, faceLm[a * 2 + 1] * h);
				ctx.lineTo(faceLm[b * 2] * w, faceLm[b * 2 + 1] * h);
			}
			ctx.stroke();
		}
		for (const hand of handsLm) {
			if (!hand.length) continue;
			ctx.strokeStyle = 'rgba(124,199,255,0.85)';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			for (let i = 0; i < handConns.length; i += 2) {
				const a = handConns[i];
				const b = handConns[i + 1];
				ctx.moveTo(hand[a * 2] * w, hand[a * 2 + 1] * h);
				ctx.lineTo(hand[b * 2] * w, hand[b * 2 + 1] * h);
			}
			ctx.stroke();
			ctx.fillStyle = 'rgba(237,237,240,0.9)';
			for (let i = 0; i < hand.length; i += 2) {
				ctx.beginPath();
				ctx.arc(hand[i] * w, hand[i + 1] * h, 3, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	async function flip() {
		const nf = facing === 'user' ? 'environment' : 'user';
		// Android holds the camera device, so release it before opening the other.
		stream?.getVideoTracks().forEach((t) => t.stop());
		try {
			const next = await getCameraStream(nf);
			facing = nf;
			const track = next.getVideoTracks()[0];
			if (sender) await sender.replaceTrack(track);
			stream = next;
			attachSelf();
			sendMeta();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			try {
				const back = await getCameraStream(facing);
				if (sender) await sender.replaceTrack(back.getVideoTracks()[0]);
				stream = back;
				attachSelf();
			} catch {
				/* ignore */
			}
		}
	}

	function requestRotate() {
		sig?.send({ type: 'rotate' });
	}

	function cleanup() {
		if (watchdog) clearTimeout(watchdog);
		window.removeEventListener('orientationchange', detectOrientation);
		window.removeEventListener('resize', detectOrientation);
		stream?.getTracks().forEach((t) => t.stop());
		pc?.close();
		sig?.close();
	}
	onDestroy(cleanup);

	const statusText = $derived(
		lost
			? 'Disconnected'
			: {
					init: 'Connecting…',
					connecting: 'Pairing…',
					ready: 'Waiting for desktop…',
					streaming: 'Streaming to your computer',
					denied: 'Pairing rejected — reopen the link from the app',
					error: 'Error'
				}[status]
	);
</script>

<main class="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-6">
	<header class="flex items-center gap-2.5">
		<span
			class="inline-block h-2.5 w-2.5 rounded-full {lost
				? 'bg-red-500'
				: status === 'streaming'
					? 'bg-accent'
					: status === 'error' || status === 'denied'
						? 'bg-red-500'
						: 'bg-white/60'}"
			style={!lost && status !== 'streaming' && status !== 'error' && status !== 'denied'
				? 'animation: fb-pulse 1.4s ease-in-out infinite;'
				: ''}
		></span>
		<h1 class="text-lg font-semibold">Faceboard Camera</h1>
	</header>

	<div
		onclick={() => (expanded = !expanded)}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				expanded = !expanded;
			}
		}}
		class="relative mx-auto w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-surface-2"
		style="aspect-ratio: {expanded ? aspect : 16 / 9}"
		role="button"
		tabindex="0"
		aria-label={expanded ? 'Collapse camera preview' : 'Expand camera preview'}
	>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={selfVideo}
			class="h-full w-full object-cover transition-all {lost ? 'blur-md brightness-50' : ''}"
			muted
			playsinline
			autoplay
		></video>
		<canvas
			bind:this={overlayCanvas}
			class="pointer-events-none absolute inset-0 h-full w-full object-cover {lost ? 'opacity-0' : ''}"
		></canvas>

		{#if lost}
			<div class="absolute inset-0 grid place-items-center bg-red-950/40 text-center">
				<div class="px-6">
					<svg class="mx-auto mb-2 text-red-400" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
					<p class="text-[15px] font-semibold text-red-300">Disconnected</p>
					<p class="mt-1 text-[12px] text-red-200/80">Faceboard on your computer is unreachable. Reopen the link when it's back.</p>
				</div>
			</div>
		{/if}

		<!-- expand/collapse affordance -->
		<span class="pointer-events-none absolute top-2 left-2 rounded-md bg-black/45 px-2 py-1 text-[11px] text-white/85 backdrop-blur-sm">
			{expanded ? 'Tap to collapse' : 'Tap to expand'}
		</span>

		<!-- camera controls embedded bottom-right; stop propagation so they don't
		     toggle the expand/collapse on the container. -->
		<div class="absolute right-2 bottom-2 flex items-center gap-2">
			<button
				onclick={(e) => { e.stopPropagation(); flip(); }}
				aria-label="Flip camera"
				class="flex items-center gap-1.5 rounded-lg bg-black/50 px-2.5 py-1.5 text-[12px] text-white/90 backdrop-blur-sm transition-colors active:bg-black/70"
			>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3l2-2h4l1 1" /><path d="M14.5 4.5 17 7l2.5-2.5" /><path d="M17 7v4" /><circle cx="11" cy="12" r="3" /></svg>
				Flip
			</button>
			<button
				onclick={(e) => { e.stopPropagation(); requestRotate(); }}
				aria-label="Rotate 90 degrees"
				class="flex items-center gap-1.5 rounded-lg bg-black/50 px-2.5 py-1.5 text-[12px] text-white/90 backdrop-blur-sm transition-colors active:bg-black/70"
			>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>
				Rotate
			</button>
		</div>
	</div>

	<div class="rounded-card border border-border bg-surface-1 px-4 py-2 text-[13px]">
		<div class="flex items-center justify-between border-b border-border py-2">
			<span class="text-faint">Status</span><span class={lost ? 'text-red-300' : 'text-text'}>{statusText}</span>
		</div>
		<div class="flex items-center justify-between border-b border-border py-2">
			<span class="text-faint">Connected to</span><span class="truncate pl-3 text-text">{host}</span>
		</div>
		<div class="flex items-center justify-between border-b border-border py-2">
			<span class="text-faint">Camera</span><span class="text-text">{facing === 'user' ? 'Front' : 'Back'}</span>
		</div>
		<div class="flex items-center justify-between py-2">
			<span class="text-faint">Orientation</span><span class="text-text capitalize">{orientation}</span>
		</div>
		{#if error}<p class="pb-2 text-[12px] text-red-400">{error}</p>{/if}
	</div>

	<p class="mt-auto text-center text-[12px] text-faint">
		Keep this page open — your camera streams to Faceboard over your local network.
	</p>
</main>
