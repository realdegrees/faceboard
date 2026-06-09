import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import serve from 'electron-serve';

const isDev = process.env.NODE_ENV === 'development';

// In production the SvelteKit static build is served from a custom app:// scheme.
const loadProd = isDev
	? null
	: serve({ directory: path.join(__dirname, '..', 'build') });

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
	mainWindow = new BrowserWindow({
		width: 1140,
		height: 740,
		minWidth: 900,
		minHeight: 580,
		show: false,
		frame: false,
		titleBarStyle: 'hidden',
		backgroundColor: '#0a0a0b',
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			// Keep the webcam + detection loop running at full rate while the
			// window is minimized or hidden in the tray.
			backgroundThrottling: false
		}
	});

	mainWindow.once('ready-to-show', () => mainWindow?.show());

	// Open external links in the user's browser, never inside the app window.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith('http')) shell.openExternal(url);
		return { action: 'deny' };
	});

	if (isDev) {
		await mainWindow.loadURL('http://localhost:5173');
		mainWindow.webContents.openDevTools({ mode: 'detach' });
	} else {
		await loadProd!(mainWindow);
	}
}

// Window chrome controls for the custom frameless title bar.
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.on('window:toggle-maximize', () => {
	if (!mainWindow) return;
	if (mainWindow.isMaximized()) mainWindow.unmaximize();
	else mainWindow.maximize();
});

// Single instance — focus the existing window instead of spawning a second app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on('second-instance', () => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.show();
			mainWindow.focus();
		}
	});

	app.whenReady().then(createWindow);

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
}
