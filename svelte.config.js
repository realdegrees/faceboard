import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '200.html',
			precompress: false,
			strict: true
		}),
		// Relative asset paths so the bundle works both under electron-serve's
		// custom protocol and when served over HTTP to a phone on the LAN.
		paths: { relative: true }
	}
};

export default config;
