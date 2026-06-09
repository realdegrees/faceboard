// Audio integration test: prove sound:read returns valid bytes and Web Audio
// can decode them inside Electron. Run with: electron scripts/audio-it-main.cjs
const { app, BrowserWindow } = require('electron');
const express = require('express');
const path = require('node:path');
const os = require('node:os');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const { registerIpc } = require(path.join(__dirname, '..', 'dist-electron', 'ipc.cjs'));
const buildDir = path.join(__dirname, '..', 'build');
const WAV = process.env.FB_WAV || path.join(os.tmpdir(), 'fb-beep.wav');

app.whenReady().then(async () => {
	registerIpc();
	const server = express();
	server.use(express.static(buildDir));
	server.get('*', (_q, r) => r.sendFile(path.join(buildDir, '200.html')));
	const hs = server.listen(0);
	const port = hs.address().port;

	const win = new BrowserWindow({
		show: false,
		webPreferences: {
			preload: path.join(__dirname, '..', 'dist-electron', 'preload.cjs'),
			contextIsolation: true,
			sandbox: true
		}
	});
	await win.loadURL(`http://localhost:${port}/`);

	const result = await win.webContents.executeJavaScript(`(async () => {
		const data = await window.faceboard.sounds.read(${JSON.stringify(WAV)});
		const ctx = new AudioContext();
		const buf = await ctx.decodeAudioData(data);
		return { ok: buf.duration > 0.2 && buf.duration < 0.5, bytes: data.byteLength,
			duration: +buf.duration.toFixed(3), channels: buf.numberOfChannels, sampleRate: buf.sampleRate };
	})()`);

	console.log('AUDIO_RESULT ' + JSON.stringify(result));
	hs.close();
	app.quit();
	process.exit(result && result.ok ? 0 : 1);
});
