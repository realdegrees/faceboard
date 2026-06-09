// Detection integration test: prove MediaPipe loads its WASM runtime + .task
// models from our LOCAL static assets and runs real inference inside Electron's
// renderer (no network). Loads a portrait, runs Face Landmarker, and also
// constructs the Gesture Recognizer to confirm the hand model loads too.
// Run with: electron scripts/detect-it-main.cjs
const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
const SAMPLE = process.env.FB_SAMPLE || path.join(os.tmpdir(), 'fb-portrait.jpg');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="result"></div>
<script type="module">
  import { FilesetResolver, FaceLandmarker, GestureRecognizer } from '/vision/vision_bundle.mjs';
  const out = (o) => { document.getElementById('result').textContent = JSON.stringify(o); };
  try {
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const face = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'CPU' },
      outputFaceBlendshapes: true, runningMode: 'IMAGE', numFaces: 1
    });
    const hand = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/mediapipe/models/gesture_recognizer.task', delegate: 'CPU' },
      runningMode: 'IMAGE', numHands: 2
    });
    const img = new Image();
    img.src = '/sample.jpg';
    await img.decode();
    const res = face.detect(img);
    const cats = res.faceBlendshapes?.[0]?.categories ?? [];
    const top = cats.filter(c => c.categoryName !== '_neutral')
      .sort((a, b) => b.score - a.score).slice(0, 5)
      .map(c => c.categoryName + ':' + c.score.toFixed(3));
    out({ ok: cats.length > 0, faceModel: true, handModel: !!hand, blendshapeCount: cats.length, top });
  } catch (err) {
    out({ ok: false, error: String(err && err.message || err) });
  }
</script></body></html>`;

app.whenReady().then(async () => {
	const server = express();
	server.use('/vision', express.static(path.join(root, 'node_modules/@mediapipe/tasks-vision')));
	server.use('/mediapipe', express.static(path.join(root, 'static/mediapipe')));
	server.get('/sample.jpg', (_q, r) => r.sendFile(SAMPLE));
	server.get('/', (_q, r) => r.type('html').send(PAGE));
	const httpServer = server.listen(0);
	const port = httpServer.address().port;

	const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
	const logs = [];
	win.webContents.on('console-message', (_e, _l, m) => logs.push(m));
	await win.loadURL(`http://localhost:${port}/`);

	let result = '';
	const deadline = Date.now() + 45000;
	while (Date.now() < deadline) {
		result = await win.webContents.executeJavaScript(
			"document.getElementById('result').textContent"
		);
		if (result) break;
		await new Promise((r) => setTimeout(r, 500));
	}

	console.log('DETECT_RESULT ' + (result || '(timeout)'));
	if (!result && logs.length) console.log('LOGS:\n' + logs.slice(-10).join('\n'));
	httpServer.close();
	app.quit();
	let parsed = {};
	try {
		parsed = JSON.parse(result);
	} catch {}
	process.exit(parsed.ok ? 0 : 1);
});
