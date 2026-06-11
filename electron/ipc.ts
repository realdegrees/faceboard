import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getSettings, saveSettings } from './settings';
import { lanInfo, startLan, stopLan } from './lan-server';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm'];
const BUILD_DIR = path.join(__dirname, '..', 'build');

// electron-builder sets PORTABLE_EXECUTABLE_DIR only for the portable target,
// which runs from a temp dir that's re-extracted on every launch. A login item
// would point at that stale path, so launch-on-startup is offered for installed
// builds only.
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;

interface StartupState {
	isPortable: boolean;
	openAtLogin: boolean;
}
function startupState(): StartupState {
	return { isPortable, openAtLogin: isPortable ? false : app.getLoginItemSettings().openAtLogin };
}

/** Register the main-process IPC handlers that aren't tied to a window. */
export function registerIpc(): void {
	ipcMain.handle('settings:get', async () => getSettings());
	ipcMain.handle('settings:set', async (_e, doc: unknown) => {
		await saveSettings(doc);
	});

	// Browse for one or more audio files.
	ipcMain.handle('dialog:open-sounds', async () => {
		const win = BrowserWindow.getFocusedWindow() ?? undefined;
		const res = await dialog.showOpenDialog(win!, {
			title: 'Add sounds',
			properties: ['openFile', 'multiSelections'],
			filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
		});
		if (res.canceled) return [];
		return res.filePaths.map((p) => ({ path: p, name: path.basename(p) }));
	});

	// Read an audio file as raw bytes for the renderer's Web Audio decoder.
	ipcMain.handle('sound:read', async (_e, filePath: string) => {
		const buf = await readFile(filePath);
		return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	});

	ipcMain.handle('sound:exists', async (_e, filePath: string) => existsSync(filePath));

	// Launch-on-startup (login item). No-op on portable builds (see isPortable).
	ipcMain.handle('app:get-startup', () => startupState());
	ipcMain.handle('app:set-startup', (_e, enabled: boolean) => {
		if (!isPortable) app.setLoginItemSettings({ openAtLogin: !!enabled });
		return startupState();
	});

	// Phone-as-webcam LAN server (HTTPS + WebSocket signaling).
	ipcMain.handle('lan:start', async () => startLan(BUILD_DIR));
	ipcMain.handle('lan:stop', async () => {
		await stopLan();
	});
	ipcMain.handle('lan:info', () => lanInfo());
}
