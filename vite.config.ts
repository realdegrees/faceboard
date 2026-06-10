import { readFileSync } from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Injected at build time so the app can show its own version + repo link.
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_REPO__: JSON.stringify('https://github.com/realdegrees/faceboard')
	},
	server: {
		port: 5173,
		strictPort: true,
		// Allow a phone on the LAN to reach the Vite dev server during development.
		host: true
	}
});
