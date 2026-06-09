// Stage the MediaPipe runtime + models into static/ so the running app loads
// them locally and never touches the network. WASM is copied from the installed
// package; the .task models are downloaded once at build/dev time (not by the
// app at runtime). Idempotent — skips anything already present.
import { cp, mkdir, access, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const requireAll = process.argv.includes('--require');
const root = path.resolve(import.meta.dirname, '..');
const wasmSrc = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = path.join(root, 'static/mediapipe/wasm');
const modelsDir = path.join(root, 'static/mediapipe/models');

const MODELS = [
	{
		file: 'face_landmarker.task',
		url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
	},
	{
		file: 'gesture_recognizer.task',
		url: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'
	}
];

async function exists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

await mkdir(wasmDst, { recursive: true });
await cp(wasmSrc, wasmDst, { recursive: true });
console.log('[fetch-models] wasm runtime staged');

await mkdir(modelsDir, { recursive: true });
const missing = [];
for (const m of MODELS) {
	const dst = path.join(modelsDir, m.file);
	if ((await exists(dst)) && (await stat(dst)).size > 100_000) {
		console.log(`[fetch-models] ${m.file} present`);
		continue;
	}
	try {
		console.log(`[fetch-models] downloading ${m.file} ...`);
		const res = await fetch(m.url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		await pipeline(Readable.fromWeb(res.body), createWriteStream(dst));
		console.log(`[fetch-models] ${m.file} downloaded`);
	} catch (err) {
		console.warn(`[fetch-models] FAILED ${m.file}: ${err.message}`);
		missing.push(m.file);
	}
}

if (missing.length && requireAll) {
	console.error(`[fetch-models] required models missing: ${missing.join(', ')}`);
	process.exit(1);
}
