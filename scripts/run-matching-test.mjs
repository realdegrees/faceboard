import esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = path.join(tmpdir(), `fb-matching-test-${process.pid}.mjs`);
await esbuild.build({
	entryPoints: ['scripts/test-matching.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile: out,
	logLevel: 'error'
});
await import(pathToFileURL(out).href);
