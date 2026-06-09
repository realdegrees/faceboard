/**
 * Typed accessor for the `window.faceboard` bridge exposed by the Electron
 * preload. Returns `null` when the UI is running outside Electron (e.g. the
 * phone page loaded in a mobile browser over the LAN), so callers can degrade
 * gracefully instead of crashing.
 */
export interface FaceboardApi {
	platform: string;
	window: {
		minimize(): void;
		close(): void;
		toggleMaximize(): void;
		isMaximized(): Promise<boolean>;
	};
	settings: {
		get(): Promise<unknown | null>;
		set(doc: unknown): Promise<void>;
	};
	sounds: {
		openDialog(): Promise<{ path: string; name: string }[]>;
		read(filePath: string): Promise<ArrayBuffer>;
		exists(filePath: string): Promise<boolean>;
	};
}

export function getBridge(): FaceboardApi | null {
	if (typeof window === 'undefined') return null;
	return (window as Window & { faceboard?: FaceboardApi }).faceboard ?? null;
}

export const isDesktop = (): boolean => getBridge() !== null;
