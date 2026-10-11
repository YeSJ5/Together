# TOGETHER

TOGETHER is a final-year major project for QR-based real-time multi-user audio streaming. A host starts a room, shares live audio, and nearby listeners join instantly by scanning a QR code. The project is designed for classrooms, seminars, hostels, group study, and shared listening scenarios where low-friction audio access matters more than full video conferencing.

The current production flow is centered on:

- a Vercel deployment for the TOGETHER frontend
- Render for the backend API and signaling support
- WebRTC for audio delivery
- Express for session APIs
- Vite + React for the client app

## Problem Statement

When one person wants to share live audio with a small nearby group, the usual options are inconvenient:

- passing around a device or speaker reduces clarity
- Bluetooth sharing does not scale well for multiple listeners
- live streaming platforms add too much setup and latency
- QR joining is often missing from lightweight real-time tools

TOGETHER solves this by letting one host create a room and distribute a scan-to-join audio session in a few seconds.

## Project Objective

Build a clean, production-style full-stack system where:

- a host starts a live session
- the app generates a room ID and QR code
- listeners join on phone or laptop
- host audio is streamed in real time
- the room shows live participant presence
- the group can exchange quick text messages during the session

## Core Features

### Live audio sharing

- Device audio sharing on supported desktop browsers using browser media capture
- Microphone sharing as a fallback mode
- Audio file hosting mode for mobile-friendly fallback sharing
- WebRTC-based low-latency audio streaming

### QR-based joining

- Automatic room creation
- Join URL generation
- QR code rendering on the host dashboard
- Listener join page with:
  - direct room validation
  - camera QR scan
  - QR-from-image fallback
  - manual room entry fallback

### Live room management

- real-time listener count
- participant list with host and listeners
- room activity feed for joins and leaves
- session end handling
- invalid/expired room handling

### Room communication

- built-in room chat
- listener can message everyone or host only
- host can message the full room
- duplicate local chat echo issue fixed so messages display once

### Mobile and PWA support

- mobile-responsive UI
- install prompt for supported mobile browsers
- PWA service worker for quicker re-entry
- better mobile join flow than plain URL entry
- background/media-session support where browser capabilities allow it

## Current Working Product Flow

### Host flow

1. Open the host page.
2. Choose an audio source:
   - `Device Audio`
   - `Microphone`
   - `Audio File`
3. Start the session.
4. Share the generated QR code or join link.
5. Watch participants join in real time.
6. End the session when finished.

### Listener flow

1. Scan the QR code or open the join link.
2. Validate the room on the join page.
3. Enter a name if needed.
4. Tap `Join Audio`.
5. Move into the live listening page.
6. Control playback volume and use room chat if required.

## Tech Stack

### Frontend

- React
- Vite
- React Router
- custom responsive CSS
- `react-qr-code`
- `socket.io-client`
- `jsqr`

### Backend

- Node.js
- Express.js
- Socket.IO
- CORS
- in-memory session storage for MVP behavior

### Realtime streaming

- WebRTC for audio stream transport
- Socket.IO and HTTP polling endpoints for signaling/session coordination

### Mobile wrapper

- Capacitor Android project included
- native Android layer kept in the repo for future extension

## Folder Structure

```text
TOGETHER/
|-- frontend/
|   |-- public/
|   |   |-- manifest.webmanifest
|   |   |-- sw.js
|   |   |-- icon-192.svg
|   |   `-- icon-512.svg
|   |-- src/
|   |   |-- components/
|   |   |   |-- AppShell.jsx
|   |   |   |-- PwaPrompt.jsx
|   |   |   `-- StatusBadge.jsx
|   |   |-- lib/
|   |   |   |-- api.js
|   |   |   |-- config.js
|   |   |   |-- ids.js
|   |   |   |-- nativeAudio.js
|   |   |   |-- sanitize.js
|   |   |   |-- socket.js
|   |   |   |-- storage.js
|   |   |   |-- useNavigationLock.js
|   |   |   `-- webrtc.js
|   |   |-- pages/
|   |   |   |-- HomePage.jsx
|   |   |   |-- HostDashboardPage.jsx
|   |   |   |-- ListenerJoinPage.jsx
|   |   |   `-- LiveSessionPage.jsx
|   |   |-- App.jsx
|   |   |-- main.jsx
|   |   `-- styles.css
|   |-- android/
|   |-- package.json
|   `-- vite.config.js
|-- backend/
|   |-- src/
|   |   |-- config.js
|   |   |-- server.js
|   |   `-- sessionStore.js
|   `-- package.json
|-- package.json
|-- vercel.json
|-- render.yaml
`-- README.md
```

## System Architecture

```text
Host Device
  -> capture audio
  -> create room
  -> generate QR/link
  -> publish WebRTC offer

Listener Device
  -> scan QR
  -> validate room
  -> join room
  -> receive WebRTC stream

Backend
  -> create/manage session records
  -> store listener presence in memory
  -> relay signaling events
  -> expose session APIs
```

## API Endpoints

### Session endpoints

- `POST /create-session`
- `GET /session/:id`
- `DELETE /session/:id`
- `POST /session/:id/join`
- `POST /session/:id/leave`
- `POST /session/:id/events`
- `GET /session/:id/events`

### Health/runtime endpoints

- `GET /api`
- `GET /api/health`
- `GET /api/runtime`

### Example session object

```json
{
  "roomId": "ROOM-AX27",
  "hostId": "host123",
  "hostName": "Host",
  "users": [],
  "createdAt": 1710000000000,
  "status": "active",
  "audioSourceMode": "device-audio"
}
```

## Realtime Events Used

- `host-created-room`
- `listener-joined-room`
- `user-count-updated`
- `listener-disconnected`
- `session-ended`
- `signal:offer`
- `signal:answer`
- `signal:ice-candidate`
- `chat-message`

## Supported Audio Modes

### 1. Device Audio

Best for desktop Chrome/Edge when the host wants to share:

- YouTube tab audio
- browser video audio
- browser-based learning content
- system/tab audio where the browser permits it

### 2. Microphone

Best fallback for:

- announcements
- speaking sessions
- simple mobile hosting

### 3. Audio File

Best fallback for:

- mobile-hosted demo sessions
- lectures, podcast clips, music files
- phones where device output capture is not supported

## Browser and Device Notes

### Best supported host environment

- Google Chrome desktop
- Microsoft Edge desktop

### Best supported listener environment

- Chrome on Android
- Chrome/Edge on desktop

### Important limitations

- true device/system output sharing is most reliable on desktop browsers
- mobile browsers generally do not support full device-output capture consistently
- autoplay restrictions may require a manual tap on some listener devices
- full background audio behavior depends on browser and OS media-session behavior
- in-memory sessions are fine for MVP/demo use, but not ideal for large-scale production persistence

## PWA and Mobile Behavior

The web app includes:

- install prompt support
- service worker
- manifest
- mobile-first join flow

This improves:

- faster reopen after initial use
- cleaner mobile experience
- easier listener access on repeated sessions

## Android Layer

The repository also contains an Android wrapper under `frontend/android`.

This was added to explore:

- native installable app behavior
- better mobile hosting paths
- deeper background audio handling
- Android-specific system audio capture experiments

The main working project flow remains the web/PWA deployment, but the Android layer stays in the repository for future extension.

## Local Development

### Install dependencies

From the project root:

```bash
npm run setup
```

### Root scripts

```bash
npm run build
npm start
npm run dev:backend
npm run dev:frontend
npm run android:build
npm run android:sync
npm run android:open
```

### Frontend scripts

Inside `frontend/`:

```bash
npm run dev
npm run dev:network
npm run build
npm run preview
```

### Backend scripts

Inside `backend/`:

```bash
npm run dev
npm start
```

## Environment Variables

### Backend

```bash
PORT=5000
CLIENT_ORIGIN=*
```

For public deployment:

```bash
PORT=5000
CLIENT_ORIGIN=https://your-frontend.vercel.app
```

### Frontend

```bash
VITE_API_BASE_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
VITE_SOCKET_PATH=/socket.io
VITE_PUBLIC_APP_URL=https://your-frontend.vercel.app
```

## Local Demo Instructions

Recommended for evaluation/demo:

1. Build the frontend.
2. Start the backend from the root using `npm start`.
3. Open `http://localhost:5000` on the host laptop.
4. Start a session.
5. Let the QR code expose the laptop’s LAN address.
6. Join from listener phones/laptops on the same Wi-Fi or hotspot.

## Production Deployment

## Frontend deployment

- platform: Vercel
- canonical public frontend: your TOGETHER Vercel deployment

### Suggested Vercel env values

```bash
VITE_API_BASE_URL=https://your-backend.onrender.com
VITE_SOCKET_URL=https://your-backend.onrender.com
VITE_SOCKET_PATH=/socket.io
VITE_PUBLIC_APP_URL=https://your-frontend.vercel.app
```

## Backend deployment

- platform: Render
- backend serves APIs and signaling/session operations

### Suggested Render env values

```bash
PORT=5000
CLIENT_ORIGIN=https://your-frontend.vercel.app
```

## Current Product Highlights (v2.5)

- **Browser-First Background Playback**: Persistent floating mini-player preserving audio state across all internal route navigation.
- **Audio Playback Path Deduping**: Unified singleton audio node (`persistentAudioRef` in `AudioRoomContext`) eliminating duplicate playback tags, audio flanging, and phantom autoplay issues. Manual play, volume, mute, resume, and teardown route exclusively through the singleton ref.
- **Production Persistence Durability & Multi-Instance Resilience**: Dual-engine persistence layer supporting SQLite for local development and managed PostgreSQL for cloud durability. Protected against dirty cache writes via optimistic rollback on query failure, periodic background reconciliation (every 15s), and authoritative async queries (`getRoomAsync`, `listPublicActiveRoomsAsync`). Accurate HTTP 503 readiness failure on database disruption.
- **WebRTC Mesh Media Load Verification**: Empirically measured in headless Chromium across progressive listener tiers:
  - **Tier 1 (5 Listeners)**: 5 of 5 receiving audio (100%), 0 packet loss, 182 kbps host upload (~36.4 kbps/peer), 5.2ms average jitter.
  - **Tier 2 (8 Listeners)**: 8 of 8 receiving audio (100%), 0 packet loss, 298 kbps host upload (~37.3 kbps/peer), 7.0ms average jitter.
- **Hardened TURN Traversal**: Parameter-sanitized ICE configuration supporting dynamic HMAC-SHA1 credentials and static auth with strict parameter validation and safe diagnostics. Frontend caches ICE credentials bounded by server TTL (`data.ttl`).
- **Live Public Stages Discovery**: Explore active broadcasts filtered by category (Music, Study, Lecture, Podcast, DJ).
- **Live Speech-to-Text Transcripts & Subtitles**: Browser speech engine transcription broadcasting real-time captions for lectures and accessibility.
- **Synchronized Track Announcement**: Host broadcasts track title and artist from Spotify, YouTube, or audio files with synchronized listener timeline.
- **Audience Micro-Reactions**: Instant emoji reactions (`👏`, `🔥`, `❤️`, `🎉`, `⚡`) with floating animated toasts.
- **Audio Settings & Diagnostics**: Microphone test meter, device switching, and Hi-Fi Stereo vs Speech Enhanced audio presets.
- **QR & Station Code Joining**: Instant mobile join via camera QR scanner or room code.
- **Zero App Required**: Runs directly in all modern desktop and mobile browsers.

## Known Limitations

- **Cloud Database Provisioning**: Render blueprint declares `together-postgres` for persistent PostgreSQL storage. When unconfigured, fallback SQLite runs in container memory (`ephemeral-container`).
- **Mobile Browsers**: Background audio execution depends on OS battery management and Web Audio wake lock policies.
- **Symmetric NAT / Restrictive Firewalls**: P2P WebRTC mesh operates smoothly across local, intranet, and STUN-traversable networks. Symmetric NAT and restrictive enterprise firewalls require external TURN relay credentials (`TURN_URLS`, `TURN_SECRET`). LiveKit SFU is supported via configuration for large-scale stages (> 8-10 peers).

## Creator Signature

Engineered & designed with precision by **S_/_/**.

## Repository & Deployment

- GitHub Repository: [https://github.com/YeSJ5/Together](https://github.com/YeSJ5/Together)
- Live Production App: [https://together-puce.vercel.app/](https://together-puce.vercel.app/)
- Live Backend Health: [https://together-1-2zi8.onrender.com/api/health](https://together-1-2zi8.onrender.com/api/health)
