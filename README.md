# TOGETHER

TOGETHER is a QR-based real-time multi-user audio streaming system built for nearby group listening. One host device shares live device audio, listeners scan a QR code, and each listener receives the stream through WebRTC with Socket.IO signaling.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YeSJ5/Together)

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
4. Listener opens `/join/:roomId`, validates room, then enters `/listen/:roomId`
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
npm run setup
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
VITE_PUBLIC_APP_URL=https://together-puce.vercel.app
```

### 3. Run locally

Build the frontend once:

```bash
npm run build
```

Start the unified host server:

```bash
npm start
```

Open `http://localhost:5000` on the host laptop. The app will automatically
generate a QR code using the laptop's LAN IP so nearby phones on the same
Wi-Fi or hotspot can join directly.

### LAN demo mode

- Host opens `http://localhost:5000`
- QR code resolves to `http://YOUR-LAPTOP-IP:5000/join/...`
- Listener joins from any phone or laptop on the same Wi-Fi or hotspot
- This is the recommended demo setup for classrooms, seminars, and project evaluation

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

## Android App Layer

TOGETHER now includes a native Android wrapper built with Capacitor in:

```text
frontend/android
```

This gives the project an installable Android app path instead of relying only
on a mobile browser tab. It is the recommended path when you want stronger
mobile behavior for playback and hosting.

### What the Android app improves

- installable app experience instead of a normal browser tab
- better resilience when switching apps or dimming the screen
- direct phone hosting in `Microphone` mode
- direct phone hosting in `Audio File` mode
- native Android background playback service for listener mode
- native Android system-audio capture path for host mode on supported devices

### Important limitation

- Android app/system audio capture works only on supported Android versions and
  only for audio sources that allow playback capture
- some protected apps may still block capture at the OS level
- this project now includes the native plugin path for that behavior inside the
  Android wrapper

### Android commands

From the project root:

```bash
npm run android:build
npm run android:open
```

What they do:

- `android:build` builds the frontend and syncs it into the Android app
- `android:open` opens the generated Android project in Android Studio

### Build the APK

1. Install Android Studio
2. Run:

```bash
npm run android:build
npm run android:open
```

3. In Android Studio, let Gradle sync
4. Use `Run` for a device/emulator, or `Build > Build APK(s)` for a test APK

## Public Deployment Setup

### Deploy backend on Render

1. Create a new Web Service from this repo on Render.
2. Set the root directory to `backend`.
3. Render can also read the included [render.yaml](C:/Users/yeshw/OneDrive/Documents/New%20project/render.yaml).
4. Add environment variables:

```bash
PORT=5000
CLIENT_ORIGIN=https://together-puce.vercel.app
```

5. After deploy, note the backend URL, for example:

```text
https://together-backend.onrender.com
```

The backend is safe to deploy independently. If the frontend bundle is not
present in the Render service, the root path returns a small backend status
response instead of failing.

### Deploy frontend on Vercel

1. Import the repo into Vercel.
2. Set the project root to `frontend`.
3. Add environment variables:

```bash
VITE_API_BASE_URL=https://your-backend.onrender.com
VITE_SOCKET_URL=https://your-backend.onrender.com
VITE_SOCKET_PATH=/socket.io
VITE_PUBLIC_APP_URL=https://together-puce.vercel.app
```

4. Use `https://together-puce.vercel.app` as the canonical frontend URL and update Render `CLIENT_ORIGIN` to that exact URL if needed.

### Preview deployments

- If you want Vercel preview deployments to connect too, `CLIENT_ORIGIN` can contain comma-separated frontend origins.
- Example:

```bash
CLIENT_ORIGIN=https://together-puce.vercel.app,https://your-frontend-git-main-yourteam.vercel.app
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
