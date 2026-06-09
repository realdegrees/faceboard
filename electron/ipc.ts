import { ipcMain } from 'electron';
import { getSettings, saveSettings } from './settings';

/** Register the main-process IPC handlers that aren't tied to a window. */
export function registerIpc(): void {
	ipcMain.handle('settings:get', async () => getSettings());
	ipcMain.handle('settings:set', async (_e, doc: unknown) => {
		await saveSettings(doc);
	});
}
