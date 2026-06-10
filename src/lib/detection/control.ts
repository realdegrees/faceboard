import { getBridge } from '$lib/bridge';
import { app } from '$lib/stores/app.svelte';
import { neededModalities } from '$lib/triggers/runtime.svelte';
import { engine } from './engine.svelte';

/**
 * Single entry point for turning detection on/off, used by the dashboard
 * toggle, the global hotkey and the tray menu. Keeps the tray's detection state
 * label in sync via the bridge.
 */
export async function startDetection(): Promise<void> {
	engine.targetFps = app.settings.general.detectionFps;
	engine.enhance = app.settings.general.enhanceLowLight;
	engine.modalities = neededModalities(app.settings.triggers);
	await engine.startDetection(app.settings.general.cameraDeviceId);
	getBridge()?.detection.notifyState(engine.detecting);
}

/** Stop the detection loop but keep the camera preview on. */
export function stopDetection(): void {
	engine.stopDetection();
	getBridge()?.detection.notifyState(false);
}

export async function toggleDetection(): Promise<void> {
	if (engine.detecting || engine.status === 'loading') {
		stopDetection();
	} else {
		await startDetection();
	}
}
