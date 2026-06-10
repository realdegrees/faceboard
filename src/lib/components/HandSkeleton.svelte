<script lang="ts">
	import { GestureRecognizer } from '@mediapipe/tasks-vision';

	// frames: one entry per animation frame; each is a flat list of 3D points
	// (21 per hand). Static poses pass a single frame; dynamic gestures animate.
	let { frames, size = 108 }: { frames: number[][]; size?: number } = $props();

	const CONN = GestureRecognizer.HAND_CONNECTIONS;
	let canvasEl = $state<HTMLCanvasElement>();
	let rotX = $state(-0.15);
	let rotY = $state(0.5);
	let frameIdx = $state(0);
	let dragging = false;
	let lastX = 0;
	let lastY = 0;

	$effect(() => {
		if (frames.length <= 1) return;
		const id = setInterval(() => (frameIdx = (frameIdx + 1) % frames.length), 90);
		return () => clearInterval(id);
	});

	function project(x: number, y: number, z: number, rx: number, ry: number): [number, number] {
		const x1 = x * Math.cos(ry) + z * Math.sin(ry);
		const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
		const y2 = y * Math.cos(rx) - z1 * Math.sin(rx);
		return [x1, y2];
	}

	$effect(() => {
		const c = canvasEl;
		const f = frames[Math.min(frameIdx, frames.length - 1)];
		const rx = rotX;
		const ry = rotY;
		if (!c || !f || f.length < 9) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const w = (c.width = c.clientWidth);
		const h = (c.height = c.clientHeight);
		ctx.clearRect(0, 0, w, h);

		// grid background
		ctx.strokeStyle = 'rgba(237,237,240,0.06)';
		ctx.lineWidth = 1;
		const step = w / 8;
		for (let i = 0; i <= 8; i++) {
			ctx.beginPath();
			ctx.moveTo(i * step, 0);
			ctx.lineTo(i * step, h);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(0, i * step);
			ctx.lineTo(w, i * step);
			ctx.stroke();
		}

		const n = Math.floor(f.length / 3);
		const proj: [number, number][] = [];
		let cx = 0;
		let cy = 0;
		for (let i = 0; i < n; i++) {
			const p = project(f[i * 3], f[i * 3 + 1], f[i * 3 + 2], rx, ry);
			proj.push(p);
			cx += p[0];
			cy += p[1];
		}
		cx /= n;
		cy /= n;
		let ext = 0;
		for (const p of proj) ext = Math.max(ext, Math.hypot(p[0] - cx, p[1] - cy));
		const scale = (0.42 * w) / (ext || 1);
		const sx = (p: [number, number]) => w / 2 + (p[0] - cx) * scale;
		const sy = (p: [number, number]) => h / 2 + (p[1] - cy) * scale;

		const hands = Math.max(1, Math.round(n / 21));
		for (let g = 0; g < hands; g++) {
			const off = g * 21;
			ctx.strokeStyle = 'rgba(124,199,255,0.85)';
			ctx.lineWidth = 2;
			for (const conn of CONN) {
				const a = proj[off + conn.start];
				const b = proj[off + conn.end];
				if (!a || !b) continue;
				ctx.beginPath();
				ctx.moveTo(sx(a), sy(a));
				ctx.lineTo(sx(b), sy(b));
				ctx.stroke();
			}
			ctx.fillStyle = 'rgba(237,237,240,0.95)';
			for (let i = 0; i < 21; i++) {
				const p = proj[off + i];
				if (!p) continue;
				ctx.beginPath();
				ctx.arc(sx(p), sy(p), 2.3, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	});

	function onDown(e: PointerEvent) {
		dragging = true;
		lastX = e.clientX;
		lastY = e.clientY;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		if (!dragging) return;
		rotY += (e.clientX - lastX) * 0.012;
		rotX = Math.max(-1.3, Math.min(1.3, rotX + (e.clientY - lastY) * 0.012));
		lastX = e.clientX;
		lastY = e.clientY;
	}
	function onUp() {
		dragging = false;
	}
</script>

<canvas
	bind:this={canvasEl}
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointerleave={onUp}
	class="cursor-grab touch-none rounded-lg border border-border bg-surface-2 active:cursor-grabbing"
	style="width: {size}px; height: {size}px"
	aria-label="Hand pose preview (drag to rotate)"
></canvas>
