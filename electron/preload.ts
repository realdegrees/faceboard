import { contextBridge, ipcRenderer } from 'electron';

/**
 * The single bridge object exposed to the renderer as `window.faceboard`.
 * Everything the UI is allowed to ask the main process to do goes through here.
 */
const api = {
	platform: process.platform,
	window: {
		minimize: () => ipcRenderer.send('window:minimize'),
		close: () => ipcRenderer.send('window:close'),
		toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
		isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized')
	},
	settings: {
		get: (): Promise<unknown | null> => ipcRenderer.invoke('settings:get'),
		set: (doc: unknown): Promise<void> => ipcRenderer.invoke('settings:set', doc)
	},
	sounds: {
		openDialog: (): Promise<{ path: string; name: string }[]> =>
			ipcRenderer.invoke('dialog:open-sounds'),
		read: (filePath: string): Promise<ArrayBuffer> => ipcRenderer.invoke('sound:read', filePath),
		exists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('sound:exists', filePath)
	}
};

contextBridge.exposeInMainWorld('faceboard', api);

export type FaceboardBridge = typeof api;
