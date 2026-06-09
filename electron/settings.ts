import { app } from 'electron';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './persistence';

/** Path to the settings document. Overridable via env for tests. */
function settingsFile(): string {
	return process.env.FB_SETTINGS_FILE || path.join(app.getPath('userData'), 'settings.json');
}

/** Return the raw persisted document (or null on first run). The renderer owns
 * migration/validation, so this stays schema-agnostic. */
export async function getSettings(): Promise<unknown | null> {
	return readJson(settingsFile());
}

export async function saveSettings(doc: unknown): Promise<void> {
	await writeJsonAtomic(settingsFile(), doc);
}
