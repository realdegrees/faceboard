// Dump the portrait's 478 face landmarks (flattened, rounded) to JSON so a demo
// face trigger can be seeded for screenshotting the region editor.
const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const SAMPLE = process.env.FB_SAMPLE || path.join(os.tmpdir(), 'fb-portrait.jpg');
const OUT = process.env.FB_OUT || path.join(os.tmpdir(), 'fb-landmarks.json');

const PAGE = `<!doctype html><meta charset=utf-8><body><div id=out></div><script type="module">
  import { FilesetResolver, FaceLandmarker } from '/vision/vision_bundle.mjs';
  const v = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const f = await FaceLandmarker.createFromOptions(v, { baseOptions:{modelAssetPath:'/mediapipe/models/face_landmarker.task',delegate:'CPU'}, runningMode:'IMAGE', numFaces:1 });
  const img = new Image(); img.src='/sample.jpg'; await img.decode();
  const lm = f.detect(img).faceLandmarks[0];
  const flat = []; for (const p of lm) flat.push(Math.round(p.x*1e4)/1e4, Math.round(p.y*1e4)/1e4, Math.round(p.z*1e4)/1e4);
  document.getElementById('out').textContent = JSON.stringify(flat);
</script></body>`;

app.whenReady().then(async () => {
	const s = express();
	s.use('/vision', express.static(path.join(root, 'node_modules/@mediapipe/tasks-vision')));
	s.use('/mediapipe', express.static(path.join(root, 'static/mediapipe')));
	s.get('/sample.jpg', (_q, r) => r.sendFile(SAMPLE));
	s.get('/', (_q, r) => r.type('html').send(PAGE));
	const hs = s.listen(0);
	const win = new BrowserWindow({ show: false });
	await win.loadURL(`http://localhost:${hs.address().port}/`);
	let out = '';
	const dl = Date.now() + 40000;
	while (Date.now() < dl) {
		out = await win.webContents.executeJavaScript("document.getElementById('out').textContent");
		if (out) break;
		await new Promise((r) => setTimeout(r, 400));
	}
	fs.writeFileSync(OUT, out);
	console.log('LANDMARKS_OK ' + JSON.parse(out).length + ' values -> ' + OUT);
	hs.close();
	app.quit();
	process.exit(out ? 0 : 1);
});
