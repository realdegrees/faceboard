// Prove the mesh-alignment fix: render the face mesh into a box whose aspect
// differs from the video (object-cover), comparing OLD (canvas sized to the box
// -> squashed) vs NEW (canvas sized to the frame's intrinsic resolution +
// object-cover -> aligned). Run with: electron scripts/mesh-cover-it-main.cjs
const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const SAMPLE = process.env.FB_SAMPLE || path.join(os.tmpdir(), 'fb-portrait.jpg');
const OUT = process.env.FB_OUT || path.join(os.tmpdir(), 'fb-mesh-cover.png');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0a0a0b;display:flex;gap:16px;padding:16px;font:12px system-ui}
 .box{position:relative;width:380px;height:380px;overflow:hidden;border-radius:10px;background:#1b1b1f}
 .box img,.box canvas{position:absolute;inset:0;width:100%;height:100%}
 .lbl{position:absolute;bottom:6px;left:8px;color:#ededf0;text-shadow:0 1px 2px #000}
</style></head><body>
<div class="box"><img id="iA"><canvas id="cA"></canvas><div class="lbl">OLD — canvas sized to box</div></div>
<div class="box"><img id="iB"><canvas id="cB" style="object-fit:cover"></canvas><div class="lbl">NEW — intrinsic + object-cover</div></div>
<script type="module">
  import { FilesetResolver, FaceLandmarker, DrawingUtils } from '/vision/vision_bundle.mjs';
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const face = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE', numFaces: 1 });
  // square boxes use object-cover on the imgs
  for (const id of ['iA','iB']) { const im=document.getElementById(id); im.style.objectFit='cover'; im.src='/sample.jpg'; }
  const probe = new Image(); probe.src='/sample.jpg'; await probe.decode();
  const lm = face.detect(probe).faceLandmarks[0];
  const F = FaceLandmarker;
  function draw(canvas, w, h){
    canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d'); const du=new DrawingUtils(ctx);
    du.drawConnectors(lm, F.FACE_LANDMARKS_TESSELATION, { color:'rgba(124,199,255,0.4)', lineWidth:0.8 });
    du.drawConnectors(lm, F.FACE_LANDMARKS_FACE_OVAL, { color:'rgba(237,237,240,0.85)', lineWidth:1.6 });
    du.drawConnectors(lm, F.FACE_LANDMARKS_LIPS, { color:'rgba(124,199,255,1)', lineWidth:1.8 });
  }
  draw(document.getElementById('cA'), 380, 380);                          // OLD: box dimensions
  draw(document.getElementById('cB'), probe.naturalWidth, probe.naturalHeight); // NEW: intrinsic
  document.title = 'DONE';
</script></body></html>`;

app.whenReady().then(async () => {
	const server = express();
	server.use('/vision', express.static(path.join(root, 'node_modules/@mediapipe/tasks-vision')));
	server.use('/mediapipe', express.static(path.join(root, 'static/mediapipe')));
	server.get('/sample.jpg', (_q, r) => r.sendFile(SAMPLE));
	server.get('/', (_q, r) => r.type('html').send(PAGE));
	const hs = server.listen(0);
	const port = hs.address().port;
	const win = new BrowserWindow({ width: 820, height: 430, show: true, backgroundColor: '#0a0a0b' });
	await win.loadURL(`http://localhost:${port}/`);
	const deadline = Date.now() + 40000;
	while (Date.now() < deadline) {
		const t = await win.webContents.executeJavaScript('document.title');
		if (t === 'DONE') break;
		await new Promise((r) => setTimeout(r, 400));
	}
	await new Promise((r) => setTimeout(r, 400));
	const img = await win.webContents.capturePage();
	fs.writeFileSync(OUT, img.toPNG());
	console.log('MESH_COVER_OK ' + OUT);
	hs.close();
	app.quit();
	process.exit(0);
});
