// Procedurally-generated canonical hand skeletons for the builtin gesture
// presets, in MediaPipe's landmark order + image convention (y increases
// downward, so "up" is -y). Approximate — meant as a recognisable preview, not a
// precise capture. Custom poses come from the user's own captured landmarks.

type V3 = [number, number, number];

const norm = (v: V3): V3 => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
};

/** Three joints (PIP, DIP, TIP) from an MCP, curling toward the palm. */
function finger(mcp: V3, fan: number, curl: number, len: number): V3[] {
	const base = norm([fan, -1.6, 0]); // up = -y
	const seg = [len * 0.42, len * 0.33, len * 0.25];
	const out: V3[] = [];
	let p = mcp;
	let acc = 0;
	for (let i = 0; i < 3; i++) {
		acc += curl * 1.5;
		const c = Math.cos(acc);
		const s = Math.sin(acc);
		// fold from up(-y) toward forward(+z) then down(+y)
		const d: V3 = [base[0], base[1] * c, -base[1] * s];
		p = [p[0] + d[0] * seg[i], p[1] + d[1] * seg[i], p[2] + d[2] * seg[i]];
		out.push([p[0], p[1], p[2]]);
	}
	return out;
}

function thumb(curl: number): V3[] {
	const cmc: V3 = [-0.26, -0.1, 0.05];
	const base = norm([-0.8, -0.7, 0.2]); // out + up
	const seg = [0.17, 0.14, 0.11];
	const out: V3[] = [cmc];
	let p = cmc;
	let acc = 0;
	for (let i = 0; i < 3; i++) {
		acc += curl * 1.0;
		const c = Math.cos(acc);
		const s = Math.sin(acc);
		const d = norm([base[0] * c + 0.9 * s, base[1], base[2] * c + 0.4 * s]);
		p = [p[0] + d[0] * seg[i], p[1] + d[1] * seg[i], p[2] + d[2] * seg[i]];
		out.push([p[0], p[1], p[2]]);
	}
	return out;
}

interface Curls {
	thumb: number;
	index: number;
	middle: number;
	ring: number;
	pinky: number;
}

function rotZ(p: V3, a: number): V3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

function buildHand(curls: Curls, spin = 0): number[] {
	const mcp = {
		index: [-0.2, -0.42, 0] as V3,
		middle: [-0.05, -0.46, 0] as V3,
		ring: [0.1, -0.44, 0] as V3,
		pinky: [0.24, -0.38, 0] as V3
	};
	const pts: V3[] = [
		[0, 0, 0],
		...thumb(curls.thumb),
		mcp.index, ...finger(mcp.index, -0.35, curls.index, 0.42),
		mcp.middle, ...finger(mcp.middle, -0.05, curls.middle, 0.46),
		mcp.ring, ...finger(mcp.ring, 0.2, curls.ring, 0.42),
		mcp.pinky, ...finger(mcp.pinky, 0.45, curls.pinky, 0.36)
	];
	const spun = spin ? pts.map((p) => rotZ(p, spin)) : pts;
	return spun.flat();
}

const FIST: Curls = { thumb: 0.7, index: 1, middle: 1, ring: 1, pinky: 1 };

export const PRESET_HAND_POSES: Record<string, number[]> = {
	Open_Palm: buildHand({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }),
	Closed_Fist: buildHand(FIST),
	Pointing_Up: buildHand({ thumb: 0.5, index: 0, middle: 1, ring: 1, pinky: 1 }),
	Victory: buildHand({ thumb: 0.6, index: 0, middle: 0, ring: 1, pinky: 1 }),
	// Thumbs up/down: a fist with the thumb out, spun so the thumb points up / down.
	Thumb_Up: buildHand({ ...FIST, thumb: 0 }, Math.PI / 2),
	Thumb_Down: buildHand({ ...FIST, thumb: 0 }, -Math.PI / 2)
};
