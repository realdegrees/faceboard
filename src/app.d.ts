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
}

export {};
