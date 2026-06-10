import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { getTls } from './cert';

export interface LanInfo {
	ip: string;
	port: number;
	token: string;
	/** HTTPS URL the phone opens to stream its camera. */
	phoneUrl: string;
	/** Signaling URL the desktop renderer connects to (loopback). */
	signalUrl: string;
	/** Plain-HTTP setup page to install the certificate (no warning on this one). */
	caSetupUrl: string;
}

let httpsServer: https.Server | null = null;
let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let info: LanInfo | null = null;

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

function listen(server: http.Server | https.Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, () => resolve((server.address() as { port: number }).port));
	});
}

function setupPage(phoneUrl: string): string {
	return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Faceboard setup</title>
<style>
 body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0a0a0b;color:#ededf0;padding:22px;line-height:1.5}
 h1{font-size:20px;margin:0 0 6px} .muted{color:#8d8d96;font-size:14px}
 a.btn{display:block;text-align:center;background:#7cc7ff;color:#000;padding:14px;border-radius:12px;text-decoration:none;font-weight:600;margin:14px 0}
 .card{background:#141417;border:1px solid #2a2a30;border-radius:14px;padding:16px;margin:16px 0}
</style></head><body>
<h1>Faceboard camera</h1>
<p class="muted">Install the certificate once to use your phone as the camera with no security warning. (Or skip it and tap “Advanced → Proceed” when prompted.)</p>
<div class="card">
 <strong>1 · Install the certificate</strong>
 <a class="btn" href="/faceboard-ca.crt">Download certificate</a>
 <p class="muted"><b>iOS:</b> open it → Settings → “Profile Downloaded” → Install. Then Settings → General → About → Certificate Trust Settings → turn on “Faceboard Local CA”.</p>
 <p class="muted"><b>Android:</b> Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate → pick the file.</p>
</div>
<div class="card">
 <strong>2 · Open the camera</strong>
 <a class="btn" href="${phoneUrl}">Open Faceboard camera</a>
</div>
</body></html>`;
}

export async function startLan(buildDir: string): Promise<LanInfo> {
	if (httpsServer && info) return info;

	const token = crypto.randomBytes(16).toString('hex');
	const ips = lanIPv4s();
	const ip = ips[0] ?? '127.0.0.1';
	const tls = await getTls(ips);

	// HTTPS: the app + WebRTC signaling.
	const lanApp = express();
	lanApp.use(express.static(buildDir));
	lanApp.get('*', (_req, res) => res.sendFile(path.join(buildDir, '200.html')));
	httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, lanApp);
	wss = new WebSocketServer({ server: httpsServer });
	setupSignaling(wss, () => token);
	const port = await listen(httpsServer);

	// Plain HTTP: the certificate download + setup page (no warning to fetch a cert).
	const phoneUrl = `https://${ip}:${port}/phone?token=${token}`;
	httpServer = http.createServer((req, res) => {
		if (req.url?.startsWith('/faceboard-ca')) {
			res.setHeader('Content-Type', 'application/x-x509-ca-cert');
			res.setHeader('Content-Disposition', 'attachment; filename="faceboard-ca.crt"');
			res.end(tls.caPem);
		} else {
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.end(setupPage(phoneUrl));
		}
	});
	const httpPort = await listen(httpServer);

	info = {
		ip,
		port,
		token,
		phoneUrl,
		signalUrl: `wss://127.0.0.1:${port}`,
		caSetupUrl: `http://${ip}:${httpPort}/`
	};
	return info;
}

export async function stopLan(): Promise<void> {
	wss?.close();
	await Promise.all([
		new Promise<void>((r) => (httpsServer ? httpsServer.close(() => r()) : r())),
		new Promise<void>((r) => (httpServer ? httpServer.close(() => r()) : r()))
	]);
	httpsServer = null;
	httpServer = null;
	wss = null;
	info = null;
}

export function lanInfo(): LanInfo | null {
	return info;
}
