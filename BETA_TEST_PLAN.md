# TOGETHER v2.2 — Controlled Public Beta Test Plan & Runbook

**Product**: TOGETHER (Browser-First Synchronized Audio Platform)  
**Live Production Web App**: [https://together-puce.vercel.app/](https://together-puce.vercel.app/)  
**Backend API & Health**: [https://together-1-2zi8.onrender.com/api/health](https://together-1-2zi8.onrender.com/api/health)  
**Target Group**: 5–10 participants across heterogeneous environments (iOS, Android, macOS, Windows, Linux, Cellular 5G/4G, Office/Home WiFi).

---

## 1. Beta Participant Matrix (5–10 Devices)

| Tester ID | Device & OS | Browser | Network Type | Assigned Role | Primary Focus |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **User 1 (Host)** | MacBook / macOS 14+ | Chrome / Edge | High-speed Home WiFi (NAT2) | Broadcaster / DJ | Multi-channel mixing, local file + mic |
| **User 2 (Host Alt)**| Windows 11 PC | Chrome | Wired Ethernet (NAT1) | Broadcaster | Tab / system audio screen capture |
| **User 3** | iPhone 14/15 (iOS 17+) | Safari | Cellular 5G (Carrier CGNAT) | Listener | Mobile background playback, lock screen |
| **User 4** | Android Phone (v13+) | Chrome Mobile | Cellular 4G LTE | Listener | Audio stability, screen-off audio |
| **User 5** | Windows Laptop | Firefox | Corporate / Edu WiFi (Restrictive NAT) | Listener | STUN/TURN traversal fallback |
| **User 6** | iPad / Android Tablet | Safari / Chrome | Home WiFi 5 GHz | Listener | Live transcription subtitles, reactions |
| **User 7** | Linux Desktop | Chromium | Home Broadband | Listener | Internal navigation & mini-player |
| **User 8** | Android Phone | Chrome Mobile | Low-bandwidth 3G / Throttled | Listener | Packet loss, reconnection behavior |

---

## 2. Test Execution Scenarios & Checklists

### Scenario A: Room Creation & Broadcast Setup (Host)
1. Navigate to [https://together-puce.vercel.app/studio](https://together-puce.vercel.app/studio).
2. Enter room title and select category (e.g. *Music*, *Podcast*, *Study*).
3. Click **Start Live Broadcast**.
4. **Verification**:
   - URL provides room code (`/room/ROOM-XXXX`).
   - Copy invite link and QR code display correctly.
   - Master VU meter responds to microphone or uploaded audio file.
   - Host key is securely stored in host session; public viewers cannot hijack room controls.

### Scenario B: Listener Join & Instant Audio Playback
1. Open the invite link on 5+ target devices simultaneously.
2. Enter a display name and join stage.
3. If browser requires audio gesture, tap **"Tap to Play Audio"**.
4. **Verification**:
   - Connected listeners counter updates in real time on all devices.
   - Audio is audible with clean stereo/voice clarity.
   - Delay between host transmission and listener output is sub-second (< 800 ms).

### Scenario C: Multi-Source Audio Mixing
1. Host turns on **Microphone**.
2. Host uploads a local MP3/WAV/FLAC track via **Music Player** channel.
3. Host adjusts mic volume and music track volume independently.
4. **Verification**:
   - Both voice and music are mixed cleanly without distortion or clipping.
   - Track title and artist metadata sync to all listener screens within 1 second.

### Scenario D: Mobile Background Audio & Lock-Screen Playback
1. On iPhone (Safari) and Android (Chrome), join an active room.
2. Lock the device or switch to another application / home screen.
3. **Verification**:
   - Audio stream continues playing in the background without suspension.
   - MediaSession controls appear on the device lock screen / notification drawer.
   - Unlocking the phone or returning to the browser tab resumes VU meter visualizers seamlessly.

### Scenario E: Network Switching & Disconnect Recovery
1. User 3 or User 4 toggles WiFi OFF to switch to Cellular data during live audio.
2. User drops connection for 5 seconds, then reconnects.
3. **Verification**:
   - Socket reconnection occurs automatically.
   - WebRTC renegotiation restores the audio stream without requiring full page refresh.
   - Participant counter remains consistent after reconnect.

### Scenario F: Host Departure & Clean Room Teardown
1. Host clicks **End Session** in Studio.
2. **Verification**:
   - All listeners immediately receive `Session Ended` modal notification.
   - Web Audio graphs and MediaStreams are cleanly destroyed on all clients.
   - Public directory removes the ended room.

---

## 3. Observability & Troubleshooting Diagnostics

In the event of an audio or connection anomaly during beta testing:

1. **Check Live Service Health**:
   - Query: `https://together-1-2zi8.onrender.com/api/health`
   - Verify `database.status === "connected"` and `turnConfigured`.
2. **Device Diagnostics Modal**:
   - On the web app, click **Audio Settings & Diagnostics** in the footer.
   - Review:
     - Mic VU testing level.
     - WebRTC Transport status (Direct UDP / TURN Relay).
     - Live Speech Transcription support.
3. **Browser Console Diagnostics**:
   - Filter console logs by `[WebRTC]` or `[Together]`.
   - Inspect active candidate pairs via `chrome://webrtc-internals`.

---

## 4. Beta Feedback Collection Form

Beta participants should report findings using this template:
- **Device & OS**: (e.g. iPhone 15 Pro, iOS 17.5)
- **Browser**: (e.g. Mobile Safari 17)
- **Network**: (e.g. T-Mobile 5G / Home WiFi)
- **Audio Clarity**: (Scale 1–5: 5 = Crystal Clear, 1 = Distorted/Silent)
- **Background Playback**: (Did audio play with screen locked? Yes / No)
- **Reactions / Chat**: (Did messages and emoji popups work smoothly? Yes / No)
- **Issues Observed**: (Describe any unexpected behavior or disconnects)
