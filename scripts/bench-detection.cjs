/**
 * Standalone detection benchmark. Runs the face + hand MediaPipe graphs on a
 * fixed frame with BOTH the GPU and CPU delegates and prints per-frame timings,
 * so you can see on YOUR machine which delegate is faster and what the real
 * frame rate is. Run it with:  npx electron scripts/bench-detection.cjs
 *
 * Uses the locally-served model + wasm assets in static/mediapipe (run
 * `npm run models` first if they're missing) and the @mediapipe/tasks-vision
 * bundle from node_modules — no dev server or build required.
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('ignore-gpu-blocklist');

const REPO = path.join(__dirname, '..');
const ROUTES = {
	'/': path.join(__dirname, 'bench-detection.html'),
	'/vision_bundle.mjs': path.join(REPO, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
};
const DIRS = { '/wasm/': path.join(REPO, 'static/mediapipe/wasm'), '/models/': path.join(REPO, 'static/mediapipe/models') };
const MIME = {
	'.html': 'text/html',
	'.mjs': 'text/javascript',
	'.js': 'text/javascript',
	'.wasm': 'application/wasm',
	'.task': 'application/octet-stream'
};

function resolve(urlPath) {
	if (ROUTES[urlPath]) return ROUTES[urlPath];
	for (const [prefix, dir] of Object.entries(DIRS)) {
		if (urlPath.startsWith(prefix)) return path.join(dir, urlPath.slice(prefix.length));
	}
	return null;
}

const server = http.createServer((req, res) => {
	const fp = resolve(decodeURIComponent(req.url.split('?')[0]));
	if (!fp) {
		res.writeHead(404);
		return res.end('not found');
	}
	fs.readFile(fp, (err, data) => {
		if (err) {
			res.writeHead(404);
			return res.end('not found');
		}
		res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
		res.end(data);
	});
});

server.listen(0, async () => {
	const port = server.address().port;
	await app.whenReady();
	const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
	win.webContents.on('console-message', (_e, _l, m) => {
		if (/renderer =|fps|FAILED|ERROR/.test(m)) console.log(m);
	});
	await win.loadURL(`http://localhost:${port}/`);
	const t0 = Date.now();
	while (Date.now() - t0 < 120000) {
		const done = await win.webContents.executeJavaScript('window.__done === true').catch(() => false);
		if (done) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	console.log('\n--- summary ---');
	const summary = await win.webContents
		.executeJavaScript('JSON.stringify(window.__results || { error: window.__error })')
		.catch((e) => '{"error":"' + e.message + '"}');
	console.log(summary);
	app.quit();
});
app.on('window-all-closed', () => app.quit());
