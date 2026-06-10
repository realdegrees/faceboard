<script lang="ts">
	import { DrawingUtils, FaceLandmarker, GestureRecognizer } from '@mediapipe/tasks-vision';
	import { engine } from '$lib/detection/engine.svelte';
	import { app } from '$lib/stores/app.svelte';

	// Hidden source video bound to the engine stream; everything is composited onto
	// the display canvas so aspect ratio, rotation, mirror and the mesh overlay all
	// live in one coordinate space (the rotated detection frame) and stay aligned.
	let videoEl = $state<HTMLVideoElement>();
	let canvasEl = $state<HTMLCanvasElement>();
	let displayAspect = $state(16 / 9);

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

	$effect(() => {
		const v = videoEl;
		const s = engine.stream;
		if (v && s && v.srcObject !== s) {
			v.srcObject = s;
			v.play().catch(() => {});
		} else if (v && !s) {
			v.srcObject = null;
		}
	});

	$effect(() => {
		const v = videoEl;
		const c = canvasEl;
		if (!v || !c) return;
		let raf = 0;
		let lastDraw = 0;
		const F = FaceLandmarker;

		// Cap the preview to ~30fps. Detection runs at ≤18fps and the face
		// tessellation is ~2600 segments — redrawing it every vsync (60fps) is pure
		// overhead with no visible benefit.
		const draw = (now: number) => {
			raf = requestAnimationFrame(draw);
			if (now - lastDraw < 32) return;
			lastDraw = now;
			if (v.readyState < 2 || !v.videoWidth) return;
			const r = ((engine.rotation % 360) + 360) % 360;
			const swap = r === 90 || r === 270;
			const fw = v.videoWidth;
			const fh = v.videoHeight;
			const cw = swap ? fh : fw;
			const ch = swap ? fw : fh;
			if (c.width !== cw) c.width = cw;
			if (c.height !== ch) c.height = ch;
			if (Math.abs(displayAspect - cw / ch) > 1e-3) displayAspect = cw / ch;
			const ctx = c.getContext('2d');
			if (!ctx) return;
			const mir = app.settings.general.mirror;

			ctx.save();
			ctx.clearRect(0, 0, cw, ch);
			ctx.translate(cw / 2, ch / 2);
			if (mir) ctx.scale(-1, 1);
			if (r) ctx.rotate((r * Math.PI) / 180);
			ctx.drawImage(v, -fw / 2, -fh / 2, fw, fh);
			ctx.restore();

			const face = engine.face;
			const hands = engine.hands;
			if (!face?.landmarks?.length && !hands.length) return;

			ctx.save();
			// Landmarks are already in the rotated detection frame; only the display
			// mirror needs applying.
			if (mir) {
				ctx.translate(cw, 0);
				ctx.scale(-1, 1);
			}
			const du = getDrawer(ctx);
			if (face?.landmarks?.length) {
				du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_TESSELATION, { color: ACCENT + '0.16)', lineWidth: 0.5 });
				du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_FACE_OVAL, { color: LIGHT + '0.5)', lineWidth: 1.2 });
				du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_LIPS, { color: ACCENT + '0.85)', lineWidth: 1.3 });
				du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_LEFT_EYE, { color: LIGHT + '0.7)', lineWidth: 1.1 });
				du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_RIGHT_EYE, { color: LIGHT + '0.7)', lineWidth: 1.1 });
				du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_LEFT_IRIS, { color: ACCENT + '0.9)', lineWidth: 1.2 });
				du.drawConnectors(face.landmarks, F.FACE_LANDMARKS_RIGHT_IRIS, { color: ACCENT + '0.9)', lineWidth: 1.2 });
			}
			for (const hand of hands) {
				du.drawConnectors(hand.landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: ACCENT + '0.85)', lineWidth: 2.5 });
				du.drawLandmarks(hand.landmarks, { color: LIGHT + '0.95)', fillColor: ACCENT + '0.9)', radius: 2.6, lineWidth: 1 });
			}
			ctx.restore();
		};
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div
	class="relative mx-auto w-full overflow-hidden rounded-lg bg-surface-2"
	style="aspect-ratio: {displayAspect}; max-width: calc(62vh * {displayAspect})"
>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={videoEl} class="hidden" muted playsinline></video>
	<canvas bind:this={canvasEl} class="block h-full w-full"></canvas>
</div>
