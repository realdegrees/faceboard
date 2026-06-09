import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import serve from 'electron-serve';
import { registerIpc } from './ipc';
import { getSettings } from './settings';
import { registerToggleShortcut, unregisterShortcuts } from './shortcuts';
import { createTray, setTrayDetection } from './tray';

// Triggers fire from the camera, not a click — allow sound playback without a
// prior user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const isDev = process.env.NODE_ENV === 'development';

// In production the SvelteKit static build is served from a custom app:// scheme.
const loadProd = isDev ? null : serve({ directory: path.join(__dirname, '..', 'build') });

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let closeToTray = true;
let startMinimized = false;

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

	mainWindow.once('ready-to-show', () => {
		if (!startMinimized) mainWindow?.show();
	});

	// Closing the window hides it to the tray (detection keeps running) unless
	// the user has disabled that or is actually quitting.
	mainWindow.on('close', (e) => {
		if (!isQuitting && closeToTray) {
			e.preventDefault();
			mainWindow?.hide();
		}
	});

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

function toggleWindow(): void {
	if (!mainWindow) return;
	if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
		mainWindow.hide();
	} else {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}
}

function sendToggleDetection(): void {
	mainWindow?.webContents.send('detection:toggle');
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

// Detection state + global shortcut wiring.
ipcMain.on('detection:state', (_e, active: boolean) => setTrayDetection(!!active));
ipcMain.handle('shortcuts:register', (_e, accelerator: string | null) =>
	registerToggleShortcut(accelerator, sendToggleDetection)
);

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

	app.whenReady().then(async () => {
		// Trusted local app — allow webcam/microphone for our own content.
		session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
			callback(permission === 'media');
		});
		session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

		// Apply persisted launch behavior + register the saved hotkey early so it
		// works before the renderer finishes loading.
		const saved = (await getSettings()) as
			| { shortcuts?: { toggleDetection?: string | null }; general?: { closeToTray?: boolean; startMinimized?: boolean } }
			| null;
		closeToTray = saved?.general?.closeToTray ?? true;
		startMinimized = saved?.general?.startMinimized ?? false;
		const accel = saved?.shortcuts?.toggleDetection ?? null;
		if (accel) registerToggleShortcut(accel, sendToggleDetection);

		registerIpc();
		createTray({
			onToggleWindow: toggleWindow,
			onToggleDetection: sendToggleDetection,
			onQuit: () => {
				isQuitting = true;
				app.quit();
			}
		});
		await createWindow();
	});

	// closeToTray hides the window rather than destroying it, so this only fires
	// when the user disabled the tray behavior — in which case we do quit.
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
		else toggleWindow();
	});

	app.on('before-quit', () => {
		isQuitting = true;
	});

	app.on('will-quit', () => unregisterShortcuts());

	// Let the renderer change launch/tray behavior live.
	ipcMain.on('app:set-behavior', (_e, behavior: { closeToTray?: boolean; startMinimized?: boolean }) => {
		if (typeof behavior.closeToTray === 'boolean') closeToTray = behavior.closeToTray;
		if (typeof behavior.startMinimized === 'boolean') startMinimized = behavior.startMinimized;
	});
}
