import { globalShortcut } from 'electron';

let current: string | null = null;

/**
 * Register the global toggle-detection hotkey, replacing any previous binding.
 * Returns false if the accelerator is invalid or already taken by another app.
 */
export function registerToggleShortcut(accelerator: string | null, onTrigger: () => void): boolean {
	if (current) {
		try {
			globalShortcut.unregister(current);
		} catch {
			/* ignore */
		}
		current = null;
	}
	if (!accelerator) return true;
	try {
		const ok = globalShortcut.register(accelerator, onTrigger);
		if (ok) current = accelerator;
		return ok;
	} catch {
		return false;
	}
}

export function unregisterShortcuts(): void {
	globalShortcut.unregisterAll();
	current = null;
}
