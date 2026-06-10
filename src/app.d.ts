import type { FaceboardApi } from '$lib/bridge';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}

	interface Window {
		faceboard?: FaceboardApi;
	}

	// Injected by Vite `define` (see vite.config.ts).
	const __APP_VERSION__: string;
	const __APP_REPO__: string;
}

export {};
