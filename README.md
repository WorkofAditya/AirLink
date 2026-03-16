<div align="center">
  <img src="https://github.com/user-attachments/assets/b4a60e4d-dcb6-4d7e-80f0-aee4cbb84c19" alt="Logo" width="150" height="150">
  <h1>AirLink</h1>
  <p>Zero-config browser-to-browser file transfer (WebRTC + Cloudflare Worker signaling).</p>
</div>

## Quick Start (Local)

That’s it — no file edits, no env setup, no manual signaling URL.

```bash
git clone <your-repo-url>
cd AirLink
cd worker && npm install && cd ..
npm start
```

Open: `http://localhost:8080`

- Frontend runs on port `8080`.
- Signaling Worker runs on port `8787`.
- Frontend auto-connects to `ws://localhost:8787/ws` in local development.

To connect two devices, open the same room URL (same `#ROOMID` hash) on both devices.

## Architecture

- **Frontend:** static `index.html` + `static/script.js` + `static/styles.css`.
- **Signaling:** Cloudflare Worker (`worker/src/index.js`) with Durable Object room relay.
- **Transfer path:** files travel directly between browsers via WebRTC DataChannel.

> File bytes never pass through the Worker.

## Scripts

From repo root:

```bash
npm start       # starts Worker + static frontend together
npm run worker  # starts only worker (port 8787)
npm run frontend # starts only static site (port 8080)
```

## Deployment

### 1) Deploy Worker (signaling)

```bash
cd worker
npx wrangler deploy
```

### 2) Deploy frontend (Cloudflare Pages)

Deploy this repository as a static site.

For production, route `/ws` on your domain to the Worker (or serve the frontend from the same host/domain as the Worker endpoint).
The frontend automatically uses `wss://<current-host>/ws` in production.

## License

GPL-3.0. See `LICENSE`.
