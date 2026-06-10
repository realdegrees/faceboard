// WebRTC integration test: start the real LAN server (HTTPS + self-signed cert +
// WS signaling), then connect two Electron windows — a host and a guest that
// streams a canvas.captureStream() (no camera needed) — and confirm the host
// receives the track over a real peer connection. Run with:
//   electron scripts/webrtc-it-main.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { startLan, stopLan } = require(path.join(__dirname, '..', 'dist-electron', 'lan-server.cjs'));

app.commandLine.appendSwitch('ignore-certificate-errors');

// Trust our self-signed loopback cert.
app.on('certificate-error', (event, _wc, url, _e, _c, cb) => {
	if (/^(wss|https):\/\/(127\.0\.0\.1|localhost)/.test(url)) {
		event.preventDefault();
		cb(true);
	} else cb(false);
});

const hostPage = (url, token) => `<!doctype html><meta charset=utf-8><body><script>
	const ws = new WebSocket(${JSON.stringify(url)}); let pc; window.__r = null;
	function mkpc(){ pc = new RTCPeerConnection({iceServers:[]});
		pc.onicecandidate = e => { if(e.candidate) ws.send(JSON.stringify({kind:'signal',payload:{type:'candidate',candidate:e.candidate.toJSON()}})); };
		pc.ontrack = e => { window.__r = { ok:true, tracks: e.streams[0].getTracks().length, connected:false }; };
		pc.onconnectionstatechange = () => { if(pc.connectionState==='connected' && window.__r) window.__r.connected = true; };
	}
	ws.onopen = () => ws.send(JSON.stringify({kind:'hello',role:'host',token:${JSON.stringify(token)}}));
	ws.onmessage = async (ev) => { const m = JSON.parse(ev.data); if(m.kind!=='signal') return; const p = m.payload; if(!pc) mkpc();
		if(p.type==='offer'){ await pc.setRemoteDescription(p.sdp); const a = await pc.createAnswer(); await pc.setLocalDescription(a); ws.send(JSON.stringify({kind:'signal',payload:{type:'answer',sdp:pc.localDescription}})); }
		else if(p.type==='candidate'){ try{ await pc.addIceCandidate(p.candidate); }catch{} } };
</script></body>`;

const guestPage = (url, token) => `<!doctype html><meta charset=utf-8><body><script>
	const ws = new WebSocket(${JSON.stringify(url)}); let pc;
	ws.onopen = () => ws.send(JSON.stringify({kind:'hello',role:'guest',token:${JSON.stringify(token)}}));
	ws.onmessage = async (ev) => { const m = JSON.parse(ev.data);
		if(m.kind==='peer-joined'){ start(); }
		else if(m.kind==='signal'){ const p = m.payload; if(!pc) return; if(p.type==='answer'){ await pc.setRemoteDescription(p.sdp); } else if(p.type==='candidate'){ try{ await pc.addIceCandidate(p.candidate);}catch{} } } };
	async function start(){
		const cv = document.createElement('canvas'); cv.width=320; cv.height=240; const ctx = cv.getContext('2d');
		setInterval(()=>{ ctx.fillStyle = (Date.now()/100|0)%2 ? '#555' : '#aaa'; ctx.fillRect(0,0,320,240); }, 33);
		const stream = cv.captureStream(15);
		pc = new RTCPeerConnection({iceServers:[]});
		pc.onicecandidate = e => { if(e.candidate) ws.send(JSON.stringify({kind:'signal',payload:{type:'candidate',candidate:e.candidate.toJSON()}})); };
		for(const t of stream.getTracks()) pc.addTrack(t, stream);
		const o = await pc.createOffer(); await pc.setLocalDescription(o);
		ws.send(JSON.stringify({kind:'signal',payload:{type:'offer',sdp:pc.localDescription}}));
	}
</script></body>`;

const dataUrl = (html) => 'data:text/html;base64,' + Buffer.from(html).toString('base64');

app.whenReady().then(async () => {
	const info = await startLan(path.join(__dirname, '..', 'build'));
	const url = info.signalUrl;

	const host = new BrowserWindow({ show: false });
	const guest = new BrowserWindow({ show: false });
	await host.loadURL(dataUrl(hostPage(url, info.token)));
	await new Promise((r) => setTimeout(r, 400));
	await guest.loadURL(dataUrl(guestPage(url, info.token)));

	let result = null;
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		result = await host.webContents.executeJavaScript('window.__r');
		if (result && result.connected) break;
		await new Promise((r) => setTimeout(r, 400));
	}

	console.log('WEBRTC_RESULT ' + JSON.stringify(result));
	await stopLan();
	app.quit();
	process.exit(result && result.ok ? 0 : 1);
});
