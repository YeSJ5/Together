# TOGETHER

TOGETHER is a QR-based real-time multi-user audio streaming system built for nearby group listening. One host device shares live device audio, listeners scan a QR code, and each listener receives the stream through WebRTC with Socket.IO signaling.

## Product Goal

- Host plays audio from laptop, browser tab, video player, or music app
- Host creates a session and shows a QR code
- Listeners scan the QR and join instantly on mobile or desktop
- Audio is optimized for same Wi-Fi or hotspot classroom-style usage

## MVP Features

- React + Vite frontend with responsive premium UI
- Node.js + Express backend on port `5000`
- Socket.IO session presence and WebRTC signaling
- Host dashboard with room creation, QR code, join URL, and live listener count
- Device audio capture using `getDisplayMedia({ audio: true })`
- Optional microphone mode fallback
- Listener join validation and live playback page
- Session end, invalid room, disconnected host, unsupported browser, and playback error states
- In-memory session store for fast MVP setup

## Architecture

```text
TOGETHER/
|-- frontend/
|   |-- src/
|   |   |-- components/
|   |   |-- lib/
|   |   |-- pages/
|   |   |-- App.jsx
|   |   |-- main.jsx
|   |   `-- styles.css
|   |-- .env.example
|   |-- index.html
|   |-- package.json
|   `-- vite.config.js
|-- backend/
|   |-- src/
|   |   |-- config.js
|   |   |-- server.js
|   |   `-- sessionStore.js
|   |-- .env.example
|   `-- package.json
`-- README.md
```

### Realtime Flow

1. Host calls `POST /create-session`
2. Backend creates an in-memory room with a unique room ID
3. Frontend renders the join URL and QR code
4. Listener opens `/join/:roomId`, validates room, then enters `/session/:roomId`
5. Socket.IO events coordinate room presence and WebRTC offer/answer/ICE exchange
6. Host shares device audio and broadcasts tracks to listeners through peer connections

## API Endpoints

- `POST /create-session`
- `GET /session/:id`
- `DELETE /session/:id`
- `GET /api/health`

Example session shape:

```json
{
  "roomId": "ROOM-AX27",
  "hostId": "host123",
  "users": [],
  "createdAt": 1710000000000,
  "status": "active",
  "audioSourceMode": "device-audio"
}
```

## Socket Events

- `host-created-room`
- `listener-joined-room`
- `user-count-updated`
- `listener-disconnected`
- `session-ended`
- `signal:offer`
- `signal:answer`
- `signal:ice-candidate`

## Setup

### 1. Install dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

### 2. Configure environment variables

Backend `.env`:

```bash
PORT=5000
CLIENT_ORIGIN=*
```

Frontend `.env`:

```bash
VITE_API_BASE_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
VITE_SOCKET_PATH=/socket.io
VITE_PUBLIC_APP_URL=http://localhost:5173
```

### 3. Run locally

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

For phone testing on the same Wi-Fi:

```bash
cd frontend
npm run dev:network
```

Open `http://localhost:5173`.

### Phone testing on the same Wi-Fi

- Start the backend with `PORT=5000`
- Start the frontend with `npm run dev -- --host 0.0.0.0`
- Open the frontend from your laptop using `http://YOUR-LAPTOP-IP:5173`
- The generated QR code will then point to the LAN URL instead of `localhost`
- On your phone, open the same LAN URL or scan the QR while both devices are on the same Wi-Fi or hotspot

## Browser Support

- Best host support: latest Google Chrome or Microsoft Edge
- Best listener support: latest Chrome on Android, Chrome desktop, Edge desktop
- Safari may have stricter autoplay and device audio capture limitations

## How QR Join Works

- Host creates a session
- Frontend generates a join URL like `http://localhost:5173/join/ROOM-AX27`
- QR code is rendered from that URL
- Listener scans the QR and lands directly on the room join page

## Deployment Notes

### Frontend

- Deploy on Vercel or Netlify
- Set `VITE_API_BASE_URL` and `VITE_SOCKET_URL` to the deployed backend URL
- Set `VITE_PUBLIC_APP_URL` to the deployed frontend URL so generated QR codes use the public address
- `frontend/vercel.json` already includes SPA route rewrites for React Router

### Backend

- Deploy on Render or Railway
- Set `PORT` from the platform and set `CLIENT_ORIGIN` to the deployed frontend URL
- Replace the in-memory session store with Redis or MongoDB for production persistence
- `render.yaml` is included for a basic Render web service setup

## Public Deployment Setup

### Deploy backend on Render

1. Create a new Web Service from this repo on Render.
2. Set the root directory to `backend`.
3. Render can also read the included [render.yaml](C:/Users/yeshw/OneDrive/Documents/New%20project/render.yaml).
4. Add environment variables:

```bash
PORT=5000
CLIENT_ORIGIN=https://your-frontend.vercel.app
```

5. After deploy, note the backend URL, for example:

```text
https://together-backend.onrender.com
```

### Deploy frontend on Vercel

1. Import the repo into Vercel.
2. Set the project root to `frontend`.
3. Add environment variables:

```bash
VITE_API_BASE_URL=https://your-backend.onrender.com
VITE_SOCKET_URL=https://your-backend.onrender.com
VITE_SOCKET_PATH=/socket.io
VITE_PUBLIC_APP_URL=https://your-frontend.vercel.app
```

4. After Vercel gives you the frontend URL, update Render `CLIENT_ORIGIN` to that exact URL if needed.

### Preview deployments

- If you want Vercel preview deployments to connect too, `CLIENT_ORIGIN` can contain comma-separated frontend origins.
- Example:

```bash
CLIENT_ORIGIN=https://your-frontend.vercel.app,https://your-frontend-git-main-yourteam.vercel.app
```

## Production Considerations

- Add TURN servers for better WebRTC reliability across more network types
- Replace in-memory sessions with Redis or MongoDB
- Add auth for hosts and moderated listener access
- Add reconnect-aware session recovery
- Add analytics, bitrate tuning, and optional recording controls

## Future Enhancements

- PWA support for faster mobile re-entry
- Host controls for mute-all and per-listener diagnostics
- Session expiry policies and scheduled rooms
- Better cross-platform system audio capture support
- Admin dashboard and attendance insights
