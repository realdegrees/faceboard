import esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const isDev = process.env.NODE_ENV === 'development';

rmSync('dist-electron', { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const common = {
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'cjs',
	outdir: 'dist-electron',
	outExtension: { '.js': '.cjs' },
	// Electron is provided by the runtime; everything else is bundled in so the
	// packaged app needs no node_modules.
	external: ['electron'],
	sourcemap: isDev,
	minify: !isDev,
	logLevel: 'info'
};

await esbuild.build({
	...common,
	entryPoints: {
		main: 'electron/main.ts',
		preload: 'electron/preload.ts'
	}
});

console.log('[build-electron] done');
