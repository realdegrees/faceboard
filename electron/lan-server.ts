import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import selfsigned from 'selfsigned';

export interface LanInfo {
	ip: string;
	port: number;
	token: string;
	/** URL the phone opens (https, self-signed). */
	phoneUrl: string;
	/** Signaling URL the desktop renderer connects to (loopback). */
	signalUrl: string;
}

let server: https.Server | null = null;
let wss: WebSocketServer | null = null;
let info: LanInfo | null = null;
let cert: { cert: string; key: string } | null = null;

/** All non-internal IPv4 addresses, primary first. */
function lanIPv4s(): string[] {
	const out: string[] = [];
	for (const ifaces of Object.values(os.networkInterfaces())) {
		for (const i of ifaces ?? []) {
			if (i.family === 'IPv4' && !i.internal) out.push(i.address);
		}
	}
	return out;
}

function ensureCert(): { cert: string; key: string } {
	if (cert) return cert;
	const altNames = [
		{ type: 2, value: 'localhost' },
		{ type: 7, ip: '127.0.0.1' },
		...lanIPv4s().map((ip) => ({ type: 7, ip }))
	];
	const pems = selfsigned.generate([{ name: 'commonName', value: 'faceboard.local' }], {
		days: 3650,
		keySize: 2048,
		extensions: [{ name: 'subjectAltName', altNames }]
	});
	cert = { cert: pems.cert, key: pems.private };
	return cert;
}

/** Relay WebRTC signaling between the desktop (host) and the phone (guest). */
function setupSignaling(socketServer: WebSocketServer, getToken: () => string): void {
	let host: WebSocket | null = null;
	let guest: WebSocket | null = null;

	socketServer.on('connection', (ws: WebSocket & { role?: string }) => {
		ws.on('message', (raw) => {
			let msg: { kind?: string; role?: string; token?: string; payload?: unknown };
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}

			if (msg.kind === 'hello') {
				if (msg.token !== getToken()) {
					ws.send(JSON.stringify({ kind: 'denied' }));
					ws.close();
					return;
				}
				ws.role = msg.role;
				if (msg.role === 'host') {
					host?.close();
					host = ws;
				} else {
					guest?.close();
					guest = ws;
				}
				ws.send(JSON.stringify({ kind: 'ready' }));
				if (host && guest) {
					host.send(JSON.stringify({ kind: 'peer-joined' }));
					guest.send(JSON.stringify({ kind: 'peer-joined' }));
				}
				return;
			}

			if (msg.kind === 'signal') {
				const peer = ws.role === 'host' ? guest : host;
				peer?.send(JSON.stringify({ kind: 'signal', payload: msg.payload }));
			}
		});

		ws.on('close', () => {
			if (ws.role === 'host' && host === ws) {
				host = null;
				guest?.send(JSON.stringify({ kind: 'peer-left' }));
			} else if (ws.role === 'guest' && guest === ws) {
				guest = null;
				host?.send(JSON.stringify({ kind: 'peer-left' }));
			}
		});
	});
}

export async function startLan(buildDir: string): Promise<LanInfo> {
	if (server && info) return info;

	const token = crypto.randomBytes(16).toString('hex');
	const { cert: certPem, key } = ensureCert();

	const lanApp = express();
	lanApp.use(express.static(buildDir));
	lanApp.get('*', (_req, res) => res.sendFile(path.join(buildDir, '200.html')));

	server = https.createServer({ cert: certPem, key }, lanApp);
	wss = new WebSocketServer({ server });
	setupSignaling(wss, () => token);

	const port: number = await new Promise((resolve, reject) => {
		server!.once('error', reject);
		server!.listen(0, () => resolve((server!.address() as { port: number }).port));
	});

	const ip = lanIPv4s()[0] ?? '127.0.0.1';
	info = {
		ip,
		port,
		token,
		phoneUrl: `https://${ip}:${port}/phone?token=${token}`,
		signalUrl: `wss://127.0.0.1:${port}`
	};
	return info;
}

export async function stopLan(): Promise<void> {
	wss?.close();
	await new Promise<void>((resolve) => {
		if (!server) return resolve();
		server.close(() => resolve());
	});
	server = null;
	wss = null;
	info = null;
}

export function lanInfo(): LanInfo | null {
	return info;
}
