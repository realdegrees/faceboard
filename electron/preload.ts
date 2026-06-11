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
	},
	shortcuts: {
		register: (accelerator: string | null): Promise<boolean> =>
			ipcRenderer.invoke('shortcuts:register', accelerator)
	},
	detection: {
		// Invoked from the global hotkey or the tray menu.
		onToggle: (cb: () => void): (() => void) => {
			const listener = () => cb();
			ipcRenderer.on('detection:toggle', listener);
			return () => ipcRenderer.removeListener('detection:toggle', listener);
		},
		notifyState: (active: boolean): void => ipcRenderer.send('detection:state', active)
	},
	app: {
		setBehavior: (behavior: { closeToTray?: boolean; startMinimized?: boolean }): void =>
			ipcRenderer.send('app:set-behavior', behavior),
		getStartup: (): Promise<{ isPortable: boolean; openAtLogin: boolean }> =>
			ipcRenderer.invoke('app:get-startup'),
		setStartup: (enabled: boolean): Promise<{ isPortable: boolean; openAtLogin: boolean }> =>
			ipcRenderer.invoke('app:set-startup', enabled)
	},
	lan: {
		start: (): Promise<LanInfo> => ipcRenderer.invoke('lan:start'),
		stop: (): Promise<void> => ipcRenderer.invoke('lan:stop'),
		info: (): Promise<LanInfo | null> => ipcRenderer.invoke('lan:info')
	}
};

interface LanInfo {
	ip: string;
	port: number;
	token: string;
	phoneUrl: string;
	signalUrl: string;
	caSetupUrl: string;
}

contextBridge.exposeInMainWorld('faceboard', api);

export type FaceboardBridge = typeof api;
