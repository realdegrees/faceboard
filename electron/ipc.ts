import { BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getSettings, saveSettings } from './settings';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm'];

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
}
