# Faceboard

A local, offline desktop soundboard triggered by **facial expressions** and **hand
signs**. Point your webcam (or your phone over the LAN) at your face, and Faceboard
plays the sounds you've linked to each expression or gesture. Works in the
background and from the tray.

- 🎭 **Triggers** — built-in facial expressions & hand signs, or record your own
  with a handful of captures (on-device, no training pipeline, no network).
- 🔊 **Sounds** — link any audio file on disk to a trigger.
- ⌨️ **Shortcuts** — configurable global hotkey to toggle detection on/off.
- 📱 **Phone as webcam** — stream your phone's camera over the local network via a
  QR-code pairing page. No app install required.
- 🗄️ **Local only** — all settings, expressions and sounds are stored on your
  machine. No accounts, no networking beyond your own LAN.

## Tech stack

| Layer | Choice |
| --- | --- |
| Shell | Electron (Chromium guarantees webcam + WebGL on Windows & Linux) |
| UI | SvelteKit (Svelte 5 runes) + Tailwind v4, `adapter-static` |
| Detection | MediaPipe Tasks Vision — Face Landmarker (blendshapes) + Hand/Gesture |
| Matching | Few-shot k-NN / cosine similarity over normalized feature vectors |
| Phone link | LAN HTTP + WebSocket signaling + WebRTC |

## Development

```bash
npm install
npm run dev      # Vite dev server + Electron, hot reload
```

## Build

```bash
npm run build    # SvelteKit static build + bundled Electron main/preload
npm run dist     # Package installers/AppImage with electron-builder
```

## License

MIT
