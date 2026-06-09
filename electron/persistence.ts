import fsp from 'node:fs/promises';
import path from 'node:path';

/** Read and parse a JSON file. Returns null if the file does not exist. */
export async function readJson<T>(file: string): Promise<T | null> {
	try {
		const raw = await fsp.readFile(file, 'utf-8');
		return JSON.parse(raw) as T;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

/** Write JSON atomically (temp file + rename) so a crash mid-write can't corrupt it. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
	const tmp = `${file}.${process.pid}.tmp`;
	await fsp.mkdir(path.dirname(file), { recursive: true });
	await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
	await fsp.rename(tmp, file);
}
