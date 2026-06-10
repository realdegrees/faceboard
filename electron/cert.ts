import { app } from 'electron';
import path from 'node:path';
import forge from 'node-forge';
import { readJson, writeJsonAtomic } from './persistence';

/**
 * Local certificate authority for the phone-as-webcam HTTPS server.
 *
 * A long-lived CA is generated once and persisted; a leaf cert for the current
 * LAN IPs is signed by it (regenerated only when the IPs change). The phone
 * installs the CA once and then trusts every leaf — no more browser warnings,
 * even across IP changes. Everything stays on disk / on the LAN.
 */

interface CaFile {
	caKeyPem: string;
	caCertPem: string;
}
interface LeafFile {
	keyPem: string;
	certPem: string;
	ips: string[];
}

const caPath = () => path.join(app.getPath('userData'), 'faceboard-ca.json');
const leafPath = () => path.join(app.getPath('userData'), 'faceboard-leaf.json');

let ca: CaFile | null = null;

function generateKeyPair(bits: number): Promise<forge.pki.rsa.KeyPair> {
	return new Promise((resolve, reject) => {
		forge.pki.rsa.generateKeyPair({ bits }, (err, keypair) =>
			err ? reject(err) : resolve(keypair)
		);
	});
}

const serial = () => forge.util.bytesToHex(forge.random.getBytesSync(16));

async function ensureCa(): Promise<CaFile> {
	if (ca) return ca;
	const existing = await readJson<CaFile>(caPath());
	if (existing?.caCertPem && existing.caKeyPem) {
		ca = existing;
		return ca;
	}
	const keys = await generateKeyPair(2048);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = serial();
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86_400_000);
	const attrs = [
		{ name: 'commonName', value: 'Faceboard Local CA' },
		{ name: 'organizationName', value: 'Faceboard' }
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: true },
		{ name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
		{ name: 'subjectKeyIdentifier' }
	]);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	ca = {
		caKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
		caCertPem: forge.pki.certificateToPem(cert)
	};
	await writeJsonAtomic(caPath(), ca);
	return ca;
}

async function signLeaf(authority: CaFile, ips: string[]): Promise<LeafFile> {
	const caKey = forge.pki.privateKeyFromPem(authority.caKeyPem);
	const caCert = forge.pki.certificateFromPem(authority.caCertPem);
	const keys = await generateKeyPair(2048);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = serial();
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86_400_000);
	cert.setSubject([{ name: 'commonName', value: 'faceboard.local' }]);
	cert.setIssuer(caCert.subject.attributes);
	const altNames = [
		{ type: 2, value: 'localhost' },
		{ type: 7, ip: '127.0.0.1' },
		...ips.map((ip) => ({ type: 7, ip }))
	];
	cert.setExtensions([
		{ name: 'basicConstraints', cA: false },
		{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
		{ name: 'extKeyUsage', serverAuth: true },
		{ name: 'subjectAltName', altNames }
	]);
	cert.sign(caKey, forge.md.sha256.create());
	return {
		keyPem: forge.pki.privateKeyToPem(keys.privateKey),
		certPem: forge.pki.certificateToPem(cert),
		ips
	};
}

export interface Tls {
	key: string;
	/** Full chain: leaf + CA. */
	cert: string;
	/** The CA cert the phone installs. */
	caPem: string;
}

/** Return TLS material covering the given LAN IPs, generating/refreshing as needed. */
export async function getTls(ips: string[]): Promise<Tls> {
	const authority = await ensureCa();
	let leaf = await readJson<LeafFile>(leafPath());
	const covers = leaf && ips.every((ip) => leaf!.ips.includes(ip));
	if (!leaf || !covers) {
		leaf = await signLeaf(authority, ips);
		await writeJsonAtomic(leafPath(), leaf);
	}
	return {
		key: leaf.keyPem,
		cert: `${leaf.certPem}\n${authority.caCertPem}`,
		caPem: authority.caCertPem
	};
}
