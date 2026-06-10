// Render the MediaPipe face mesh over the sample portrait to prove DrawingUtils
// + the tessellation/contours draw correctly. Run with: electron scripts/mesh-it-main.cjs
const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const SAMPLE = process.env.FB_SAMPLE || path.join(os.tmpdir(), 'fb-portrait.jpg');
const OUT = process.env.FB_MESH_OUT || path.join(os.tmpdir(), 'fb-mesh.png');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0a0a0b}</style></head>
<body><canvas id="c"></canvas><div id="out" style="display:none"></div>
<script type="module">
  import { FilesetResolver, FaceLandmarker, DrawingUtils } from '/vision/vision_bundle.mjs';
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const face = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE', numFaces: 1
  });
  const img = new Image(); img.src = '/sample.jpg'; await img.decode();
  const W = 460, H = Math.round(460 * img.height / img.width);
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  const lm = face.detect(img).faceLandmarks[0];
  const du = new DrawingUtils(ctx);
  const F = FaceLandmarker;
  du.drawConnectors(lm, F.FACE_LANDMARKS_TESSELATION, { color: 'rgba(124,199,255,0.3)', lineWidth: 0.7 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_FACE_OVAL, { color: 'rgba(237,237,240,0.75)', lineWidth: 1.6 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_LIPS, { color: 'rgba(124,199,255,0.95)', lineWidth: 1.8 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_LEFT_EYE, { color: 'rgba(237,237,240,0.85)', lineWidth: 1.5 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_RIGHT_EYE, { color: 'rgba(237,237,240,0.85)', lineWidth: 1.5 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_LEFT_EYEBROW, { color: 'rgba(237,237,240,0.7)', lineWidth: 1.4 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_RIGHT_EYEBROW, { color: 'rgba(237,237,240,0.7)', lineWidth: 1.4 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_LEFT_IRIS, { color: 'rgba(124,199,255,1)', lineWidth: 1.6 });
  du.drawConnectors(lm, F.FACE_LANDMARKS_RIGHT_IRIS, { color: 'rgba(124,199,255,1)', lineWidth: 1.6 });
  document.getElementById('out').textContent = c.toDataURL('image/png');
</script></body></html>`;

app.whenReady().then(async () => {
	const server = express();
	server.use('/vision', express.static(path.join(root, 'node_modules/@mediapipe/tasks-vision')));
	server.use('/mediapipe', express.static(path.join(root, 'static/mediapipe')));
	server.get('/sample.jpg', (_q, r) => r.sendFile(SAMPLE));
	server.get('/', (_q, r) => r.type('html').send(PAGE));
	const hs = server.listen(0);
	const port = hs.address().port;

	const win = new BrowserWindow({ show: false });
	await win.loadURL(`http://localhost:${port}/`);

	let dataUrl = '';
	const deadline = Date.now() + 40000;
	while (Date.now() < deadline) {
		dataUrl = await win.webContents.executeJavaScript("document.getElementById('out').textContent");
		if (dataUrl) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	if (dataUrl) {
		fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
		console.log('MESH_OK ' + OUT);
	} else {
		console.log('MESH_FAIL (timeout)');
	}
	hs.close();
	app.quit();
	process.exit(dataUrl ? 0 : 1);
});
