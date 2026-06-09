// Headless smoke test: serve the built renderer over http, load it in a real
// Electron window, capture a screenshot and report any renderer errors, then
// quit. Run with: electron scripts/smoke-main.cjs
const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

const ROUTE = process.env.FB_SMOKE_ROUTE || '/';
const OUT = process.env.FB_SMOKE_OUT || '/tmp/faceboard-smoke.png';
const buildDir = path.join(__dirname, '..', 'build');

const errors = [];

app.whenReady().then(async () => {
	const server = express();
	server.use(express.static(buildDir));
	server.get('*', (_req, res) => res.sendFile(path.join(buildDir, '200.html')));
	const httpServer = server.listen(0);
	const port = httpServer.address().port;

	const win = new BrowserWindow({
		width: 1140,
		height: 740,
		show: true,
		backgroundColor: '#0a0a0b'
	});

	win.webContents.on('console-message', (_e, level, message) => {
		if (level >= 2) errors.push(`[console:${level}] ${message}`);
	});
	win.webContents.on('did-fail-load', (_e, code, desc, url) => {
		errors.push(`did-fail-load ${code} ${desc} ${url}`);
	});

	try {
		await win.loadURL(`http://localhost:${port}${ROUTE}`);
		await new Promise((r) => setTimeout(r, 1200));
		const image = await win.webContents.capturePage();
		fs.writeFileSync(OUT, image.toPNG());
		console.log(`SMOKE_OK wrote ${OUT}`);
	} catch (err) {
		errors.push(`exception: ${err && err.message}`);
	}

	if (errors.length) {
		console.log('SMOKE_ERRORS:\n' + errors.join('\n'));
	} else {
		console.log('SMOKE_CLEAN no renderer errors');
	}
	httpServer.close();
	app.quit();
	process.exit(errors.length ? 1 : 0);
});
