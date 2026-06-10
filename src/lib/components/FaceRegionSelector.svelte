<script lang="ts">
	import { FaceLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
	import { FACE_REGIONS } from '$lib/triggers/regions';

	let {
		landmarks,
		selected,
		onToggle
	}: { landmarks: number[]; selected: string[]; onToggle: (id: string) => void } = $props();

	const F = FaceLandmarker;
	function idxOf(conns: { start: number; end: number }[]): number[] {
		const s = new Set<number>();
		for (const c of conns) {
			s.add(c.start);
			s.add(c.end);
		}
		return [...s];
	}
	const REGION_INDICES: Record<string, number[]> = {
		'brow-left': idxOf(F.FACE_LANDMARKS_LEFT_EYEBROW),
		'brow-right': idxOf(F.FACE_LANDMARKS_RIGHT_EYEBROW),
		'eye-left': idxOf(F.FACE_LANDMARKS_LEFT_EYE),
		'eye-right': idxOf(F.FACE_LANDMARKS_RIGHT_EYE),
		mouth: idxOf(F.FACE_LANDMARKS_LIPS),
		cheeks: [50, 205, 425, 280, 117, 346, 101, 330],
		nose: [1, 2, 4, 5, 6, 195, 197, 98, 327],
		jaw: [152, 148, 377, 176, 400, 378, 149]
	};

	let canvasEl = $state<HTMLCanvasElement>();
	let drawer: DrawingUtils | null = null;
	let drawerCtx: CanvasRenderingContext2D | null = null;

	// Reshape + fit the captured landmarks into a centred 0..1 box (no distortion).
	const norm = $derived.by(() => {
		const n = Math.floor(landmarks.length / 3);
		if (n < 3) return [] as { x: number; y: number; z: number; visibility: number }[];
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		for (let i = 0; i < n; i++) {
			const x = landmarks[i * 3];
			const y = landmarks[i * 3 + 1];
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const scale = 0.82 / Math.max(maxX - minX, maxY - minY || 1e-6);
		const out = [];
		for (let i = 0; i < n; i++) {
			out.push({
				x: 0.5 + (landmarks[i * 3] - cx) * scale,
				y: 0.5 + (landmarks[i * 3 + 1] - cy) * scale,
				z: 0,
				visibility: 0
			});
		}
		return out;
	});

	function centroid(ids: number[]): { x: number; y: number } | null {
		if (!norm.length) return null;
		let x = 0, y = 0, c = 0;
		for (const i of ids) {
			if (norm[i]) {
				x += norm[i].x;
				y += norm[i].y;
				c++;
			}
		}
		return c ? { x: x / c, y: y / c } : null;
	}

	$effect(() => {
		const c = canvasEl;
		const sel = selected;
		const pts = norm;
		if (!c) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const w = (c.width = c.clientWidth);
		const h = (c.height = c.clientHeight);
		ctx.clearRect(0, 0, w, h);
		if (!pts.length) return;
		if (drawerCtx !== ctx) {
			drawer = new DrawingUtils(ctx);
			drawerCtx = ctx;
		}
		const du = drawer!;
		du.drawConnectors(pts, F.FACE_LANDMARKS_TESSELATION, { color: 'rgba(237,237,240,0.12)', lineWidth: 0.5 });
		du.drawConnectors(pts, F.FACE_LANDMARKS_FACE_OVAL, { color: 'rgba(237,237,240,0.3)', lineWidth: 1 });
		// Highlight selected regions.
		for (const id of sel) {
			const ids = REGION_INDICES[id] ?? [];
			ctx.fillStyle = 'rgba(124,199,255,0.95)';
			for (const i of ids) {
				const p = pts[i];
				if (!p) continue;
				ctx.beginPath();
				ctx.arc(p.x * w, p.y * h, 2.4, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	});

	function onCanvasClick(e: MouseEvent) {
		const c = canvasEl;
		if (!c || !norm.length) return;
		const rect = c.getBoundingClientRect();
		const px = (e.clientX - rect.left) / rect.width;
		const py = (e.clientY - rect.top) / rect.height;
		let best: string | null = null;
		let bestD = Infinity;
		for (const r of FACE_REGIONS) {
			const ce = centroid(REGION_INDICES[r.id] ?? []);
			if (!ce) continue;
			const d = (ce.x - px) ** 2 + (ce.y - py) ** 2;
			if (d < bestD) {
				bestD = d;
				best = r.id;
			}
		}
		if (best && bestD < 0.04) onToggle(best);
	}
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<canvas
		bind:this={canvasEl}
		onclick={onCanvasClick}
		class="aspect-square w-40 shrink-0 cursor-pointer rounded-lg border border-border bg-surface-2"
	></canvas>
	<div class="flex flex-1 flex-wrap content-start gap-1.5">
		{#each FACE_REGIONS as region (region.id)}
			{@const on = selected.includes(region.id)}
			<button
				onclick={() => onToggle(region.id)}
				class="rounded-full border px-2.5 py-1 text-[11px] transition-colors {on
					? 'border-accent/50 bg-accent/15 text-accent'
					: 'border-border bg-surface-2 text-muted hover:text-text'}"
			>
				{region.label}
			</button>
		{/each}
	</div>
</div>
