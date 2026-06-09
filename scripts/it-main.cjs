// Integration test: load the real renderer with the real preload + IPC handlers,
// then round-trip a settings document through window.faceboard.settings to prove
// the preload -> ipcMain -> persistence -> file -> back chain works end to end.
// Run with: electron scripts/it-main.cjs
const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');

process.env.FB_SETTINGS_FILE =
	process.env.FB_SETTINGS_FILE || path.join(require('node:os').tmpdir(), 'fb-it-settings.json');
try {
	fs.unlinkSync(process.env.FB_SETTINGS_FILE);
} catch {}

const { registerIpc } = require(path.join(__dirname, '..', 'dist-electron', 'ipc.cjs'));
const buildDir = path.join(__dirname, '..', 'build');

app.whenReady().then(async () => {
	registerIpc();

	const server = express();
	server.use(express.static(buildDir));
	server.get('*', (_q, r) => r.sendFile(path.join(buildDir, '200.html')));
	const httpServer = server.listen(0);
	const port = httpServer.address().port;

	const win = new BrowserWindow({
		show: false,
		webPreferences: {
			preload: path.join(__dirname, '..', 'dist-electron', 'preload.cjs'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false
		}
	});

	await win.loadURL(`http://localhost:${port}/`);

	const result = await win.webContents.executeJavaScript(`(async () => {
		const api = window.faceboard;
		if (!api || !api.settings) return { ok: false, reason: 'bridge missing' };
		const first = await api.settings.get();
		const marker = 'it-' + Math.floor(performance.now());
		const doc = {
			version: 1, marker,
			triggers: [{ id: 'a', name: 'Smile', modality: 'face', kind: 'builtin', threshold: 0.5, holdMs: 0, cooldownMs: 500, soundId: null, enabled: true, createdAt: 1 }],
			sounds: [], shortcuts: { toggleDetection: 'X' }, general: { source: 'local' }
		};
		await api.settings.set(doc);
		const back = await api.settings.get();
		return {
			ok: !!back && back.marker === marker && back.triggers.length === 1,
			firstWasNull: first === null,
			back
		};
	})()`);

	console.log('IT_RESULT ' + JSON.stringify(result));
	httpServer.close();
	app.quit();
	process.exit(result && result.ok ? 0 : 1);
});
