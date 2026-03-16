<div align="center">
  <img src="https://github.com/user-attachments/assets/b4a60e4d-dcb6-4d7e-80f0-aee4cbb84c19" alt="Logo" width="150" height="150">
  <h1>AirLink</h1>
  <p>Serverless browser-to-browser file transfer using WebRTC + Cloudflare Worker signaling.</p>
</div>

## Architecture (New)

AirLink now uses a **fully serverless** model:

- **Frontend (Cloudflare Pages):** static HTML/CSS/JS app.
- **Signaling (Cloudflare Workers + Durable Objects):** relays SDP offers/answers and ICE candidates.
- **File transport:** direct peer-to-peer over **WebRTC RTCDataChannel**.

> File bytes never pass through the Worker signaling service.

## Project Structure

- `index.html` – main UI entrypoint.
- `static/styles.css` – existing UI styles.
- `static/script.js` – WebRTC + signaling + chunked transfer logic.
- `worker/src/index.js` – Cloudflare Worker signaling relay + Durable Object room state.
- `worker/wrangler.toml` – Worker deployment configuration.

## Local Development

### 1) Frontend
Serve the repository root as static files (any static server works):

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

### 2) Worker

```bash
cd worker
npm create cloudflare@latest . -- --existing-script
npx wrangler dev
```

Then update `window.AIRLINK_CONFIG.SIGNALING_URL` in `index.html` to your Worker WebSocket endpoint, for example:

```js
wss://airlink-signaling.<your-subdomain>.workers.dev/ws
```

## Deployment

### Cloudflare Worker (signaling)

```bash
cd worker
npx wrangler deploy
```

### Cloudflare Pages (frontend)
Deploy repository root as static site output.

## Features

- Automatic room generation via URL hash.
- Peer discovery inside a shared room.
- WebRTC DataChannel file transfer with chunking for large files.
- Send text messages over the same data channel.
- Progress bar + connection status updates + basic error handling.

## License

GPL-3.0. See `LICENSE`.
