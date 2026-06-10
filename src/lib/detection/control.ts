import { getBridge } from '$lib/bridge';
import { app } from '$lib/stores/app.svelte';
import { engine } from './engine.svelte';

/**
 * Single entry point for turning detection on/off, used by the dashboard
 * toggle, the global hotkey and the tray menu. Keeps the tray's detection state
 * label in sync via the bridge.
 */
export async function startDetection(): Promise<void> {
	engine.targetFps = app.settings.general.detectionFps;
	// Always run both detectors for the live preview — the dashboard shows the face
	// mesh + hand skeleton regardless of which triggers exist, so the mesh must not
	// be gated on having a face trigger configured.
	engine.modalities = { face: true, hand: true };
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
