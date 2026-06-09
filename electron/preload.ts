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
	}
};

contextBridge.exposeInMainWorld('faceboard', api);

export type FaceboardBridge = typeof api;
