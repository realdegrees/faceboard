import { Menu, Tray, nativeImage } from 'electron';
import { TRAY_ICON_DATA_URL } from './tray-icon';

export interface TrayCallbacks {
	onToggleWindow: () => void;
	onToggleDetection: () => void;
	onQuit: () => void;
}

let tray: Tray | null = null;
let detectionActive = false;
let callbacks: TrayCallbacks | null = null;

function buildMenu(): Menu {
	return Menu.buildFromTemplate([
		{ label: 'Show / hide Faceboard', click: () => callbacks?.onToggleWindow() },
		{ type: 'separator' },
		{
			label: detectionActive ? 'Disable detection' : 'Enable detection',
			click: () => callbacks?.onToggleDetection()
		},
		{ type: 'separator' },
		{ label: 'Quit Faceboard', click: () => callbacks?.onQuit() }
	]);
}

export function createTray(cbs: TrayCallbacks): Tray {
	callbacks = cbs;
	const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
	tray = new Tray(icon);
	tray.setToolTip('Faceboard');
	tray.setContextMenu(buildMenu());
	// Single click works on Windows; the context menu is the reliable path on Linux.
	tray.on('click', () => cbs.onToggleWindow());
	return tray;
}

export function setTrayDetection(active: boolean): void {
	detectionActive = active;
	tray?.setContextMenu(buildMenu());
	tray?.setToolTip(active ? 'Faceboard — detection on' : 'Faceboard');
}
