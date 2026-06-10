/**
 * Thin WebSocket client for the LAN signaling relay. Used by both the desktop
 * (host) and the phone (guest) to exchange WebRTC offer/answer/ICE.
 */
export type SignalRole = 'host' | 'guest';

export class Signaling {
	onReady: (() => void) | null = null;
	onDenied: (() => void) | null = null;
	onPeerJoined: (() => void) | null = null;
	onPeerLeft: (() => void) | null = null;
	onSignal: ((payload: unknown) => void) | null = null;
	onClose: (() => void) | null = null;

	#ws: WebSocket | null = null;

	connect(url: string, role: SignalRole, token: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url);
			this.#ws = ws;
			ws.onopen = () => {
				ws.send(JSON.stringify({ kind: 'hello', role, token }));
				resolve();
			};
			ws.onerror = () => reject(new Error('signaling connection failed'));
			ws.onclose = () => this.onClose?.();
			ws.onmessage = (e) => {
				let msg: { kind?: string; payload?: unknown };
				try {
					msg = JSON.parse(e.data);
				} catch {
					return;
				}
				switch (msg.kind) {
					case 'ready':
						this.onReady?.();
						break;
					case 'denied':
						this.onDenied?.();
						break;
					case 'peer-joined':
						this.onPeerJoined?.();
						break;
					case 'peer-left':
						this.onPeerLeft?.();
						break;
					case 'signal':
						this.onSignal?.(msg.payload);
						break;
				}
			};
		});
	}

	send(payload: unknown): void {
		if (this.#ws?.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify({ kind: 'signal', payload }));
		}
	}

	close(): void {
		this.#ws?.close();
		this.#ws = null;
	}
}
