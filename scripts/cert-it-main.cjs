// Cert integration test: start the LAN server, download the CA over plain HTTP,
// then make an HTTPS request trusting only that CA — proving a phone that
// installs the CA connects to the LAN IP with no warning. Run with:
//   electron scripts/cert-it-main.cjs
const { app } = require('electron');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const os = require('node:os');

process.env.FB_SETTINGS_FILE =
	process.env.FB_SETTINGS_FILE || path.join(os.tmpdir(), 'fb-cert-it.json');
const { startLan, stopLan } = require(path.join(__dirname, '..', 'dist-electron', 'lan-server.cjs'));

function get(client, opts) {
	return new Promise((resolve) => {
		const req = client.get(opts, (r) => {
			let d = '';
			r.on('data', (c) => (d += c));
			r.on('end', () => resolve({ ok: true, status: r.statusCode, body: d }));
		});
		req.on('error', (e) => resolve({ ok: false, error: e.message }));
	});
}

app.whenReady().then(async () => {
	const info = await startLan(path.join(__dirname, '..', 'build'));
	const base = info.caSetupUrl.replace(/\/$/, '');

	// 1. Download the CA over plain HTTP (no warning).
	const caRes = await get(http, base + '/faceboard-ca.crt');
	const caPem = caRes.body || '';

	// 2. HTTPS to the loopback (in the cert SAN), trusting only the downloaded CA.
	const tlsRes = await get(https, {
		host: '127.0.0.1',
		port: info.port,
		path: '/',
		ca: [caPem],
		rejectUnauthorized: true,
		servername: '127.0.0.1'
	});

	const result = {
		caDownloaded: caPem.includes('BEGIN CERTIFICATE'),
		caLen: caPem.length,
		tlsTrusted: tlsRes.ok,
		tlsError: tlsRes.error,
		httpsStatus: tlsRes.status
	};
	console.log('CERT_RESULT ' + JSON.stringify(result));
	await stopLan();
	app.quit();
	process.exit(result.caDownloaded && result.tlsTrusted ? 0 : 1);
});
