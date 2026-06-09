<script lang="ts">
	import { engine } from '$lib/detection/engine.svelte';

	// Standard MediaPipe 21-point hand skeleton.
	const HAND_CONNECTIONS: [number, number][] = [
		[0, 1], [1, 2], [2, 3], [3, 4],
		[0, 5], [5, 6], [6, 7], [7, 8],
		[5, 9], [9, 10], [10, 11], [11, 12],
		[9, 13], [13, 14], [14, 15], [15, 16],
		[13, 17], [17, 18], [18, 19], [19, 20],
		[0, 17]
	];

	let videoEl = $state<HTMLVideoElement>();
	let canvasEl = $state<HTMLCanvasElement>();

	// Plumb the engine's MediaStream into the visible preview element. srcObject
	// can't be set declaratively, so this DOM write lives in an effect.
	$effect(() => {
		const v = videoEl;
		const s = engine.stream;
		if (!v) return;
		if (s && v.srcObject !== s) {
			v.srcObject = s;
			v.play().catch(() => {});
		} else if (!s) {
			v.srcObject = null;
		}
	});

	// Redraw the hand-landmark overlay whenever a new frame lands.
	$effect(() => {
		const c = canvasEl;
		const hands = engine.hands;
		if (!c) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const w = (c.width = c.clientWidth);
		const h = (c.height = c.clientHeight);
		ctx.clearRect(0, 0, w, h);
		ctx.strokeStyle = 'rgba(124,199,255,0.85)';
		ctx.fillStyle = 'rgba(124,199,255,0.95)';
		ctx.lineWidth = 2;
		for (const hand of hands) {
			const pts = hand.landmarks;
			for (const [a, b] of HAND_CONNECTIONS) {
				ctx.beginPath();
				ctx.moveTo(pts[a].x * w, pts[a].y * h);
				ctx.lineTo(pts[b].x * w, pts[b].y * h);
				ctx.stroke();
			}
			for (const p of pts) {
				ctx.beginPath();
				ctx.arc(p.x * w, p.y * h, 2.6, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	});
</script>

<div class="relative h-full w-full overflow-hidden rounded-lg bg-surface-2">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={videoEl} class="h-full w-full object-cover" muted playsinline></video>
	<canvas bind:this={canvasEl} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>
</div>
