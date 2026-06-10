<script lang="ts">
	import { DrawingUtils, FaceLandmarker, GestureRecognizer } from '@mediapipe/tasks-vision';
	import { engine } from '$lib/detection/engine.svelte';
	import { app } from '$lib/stores/app.svelte';

	// Mirror the whole preview (video + overlay together) so landmarks stay aligned.
	const mirror = $derived(app.settings.general.mirror);

	let videoEl = $state<HTMLVideoElement>();
	let canvasEl = $state<HTMLCanvasElement>();

	let drawer: DrawingUtils | null = null;
	let drawerCtx: CanvasRenderingContext2D | null = null;
	function getDrawer(ctx: CanvasRenderingContext2D): DrawingUtils {
		if (drawerCtx !== ctx) {
			drawer = new DrawingUtils(ctx);
			drawerCtx = ctx;
		}
		return drawer!;
	}

	const ACCENT = 'rgba(124,199,255,';
	const LIGHT = 'rgba(237,237,240,';

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

	// Redraw the face mesh + hand skeleton overlay whenever a new frame lands.
	$effect(() => {
		const c = canvasEl;
		const face = engine.face;
		const hands = engine.hands;
		if (!c) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const w = (c.width = c.clientWidth);
		const h = (c.height = c.clientHeight);
		ctx.clearRect(0, 0, w, h);
		const du = getDrawer(ctx);

		if (face?.landmarks?.length) {
			const F = FaceLandmarker;
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_TESSELATION, { color: ACCENT + '0.16)', lineWidth: 0.5 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_FACE_OVAL, { color: LIGHT + '0.5)', lineWidth: 1.2 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_LIPS, { color: ACCENT + '0.85)', lineWidth: 1.4 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_LEFT_EYE, { color: LIGHT + '0.7)', lineWidth: 1.1 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_RIGHT_EYE, { color: LIGHT + '0.7)', lineWidth: 1.1 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_LEFT_EYEBROW, { color: LIGHT + '0.6)', lineWidth: 1.1 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_RIGHT_EYEBROW, { color: LIGHT + '0.6)', lineWidth: 1.1 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_LEFT_IRIS, { color: ACCENT + '0.9)', lineWidth: 1.2 });
			du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_RIGHT_IRIS, { color: ACCENT + '0.9)', lineWidth: 1.2 });
		}

		for (const hand of hands) {
			du.drawConnectors(hand.landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: ACCENT + '0.85)', lineWidth: 2.5 });
			du.drawLandmarks(hand.landmarks, { color: LIGHT + '0.95)', fillColor: ACCENT + '0.9)', radius: 2.6, lineWidth: 1 });
		}
	});
</script>

<div
	class="relative h-full w-full overflow-hidden rounded-lg bg-surface-2"
	style="transform: {mirror ? 'scaleX(-1)' : 'none'}"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={videoEl} class="h-full w-full object-cover" muted playsinline></video>
	<canvas bind:this={canvasEl} class="pointer-events-none absolute inset-0 h-full w-full"></canvas>
</div>
