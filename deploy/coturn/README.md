# TOGETHER — Production Coturn TURN Relay Deployment Guide

## 1. Why a Dedicated VPS is Required for TURN Relays
WebRTC media relaying requires dynamic UDP port allocation across a wide ephemeral port range (typically UDP 49152–65535) and direct bind access to a public IPv4 address. Standard PaaS application containers (such as Render Web Services, Heroku, or Vercel) only route HTTP/WebSockets over single ports (80/443) behind HTTP reverse proxies and **cannot** bind or forward raw UDP media packets.

A standard low-cost cloud VPS is optimal for hosting Coturn:
- **Recommended Hosts**: Hetzner Cloud (CX22 ~€3.79/mo), DigitalOcean Droplet ($4/mo), Linode ($5/mo), AWS EC2 (t4g.small), or Oracle Cloud Free Tier.
- **Network Requirements**: 1 Public IPv4 address, inbound UDP & TCP traffic enabled.

---

## 2. Firewall Port Requirements

The following ports must be open on the VPS firewall (e.g., UFW or AWS Security Group):

| Port Range | Protocol | Purpose |
| :--- | :--- | :--- |
| **3478** | **UDP / TCP** | Standard STUN and TURN listening port |
| **5349** | **UDP / TCP** | Secure TURNS (TLS) listening port |
| **49152–65535** | **UDP** | WebRTC ephemeral media relay port range |
| **80 / 443** | **TCP** | Let's Encrypt Certbot challenge and renewals |
| **22** | **TCP** | Secure SSH server administration |

---

## 3. Deployment Steps on the VPS

### Step 1: DNS A Record
Create an **A Record** pointing your subdomain to the VPS public IP:
- Hostname: `turn.together-audio.live` (or your domain)
- Value: `<YOUR_VPS_PUBLIC_IP>`

### Step 2: Run Automated Setup Script
Copy `setup-coturn.sh` to the VPS and run:
```bash
chmod +x setup-coturn.sh
sudo ./setup-coturn.sh turn.together-audio.live
```

The script will:
1. Detect the server's public IP.
2. Install `coturn` and `ufw`.
3. Open all required UDP and TCP ports.
4. Generate a 32-byte hex shared secret via `openssl rand -hex 32`.
5. Write the hardened `/etc/turnserver.conf` with RFC 5766 `use-auth-secret` enabled.
6. Enable and restart the `coturn` systemd daemon.

### Step 3: (Optional) Secure TLS with Let's Encrypt
To enable `turns:` on port 5349:
```bash
sudo certbot certonly --standalone -d turn.together-audio.live
```
In `/etc/turnserver.conf`, uncomment:
```
cert=/etc/letsencrypt/live/turn.together-audio.live/fullchain.pem
pkey=/etc/letsencrypt/live/turn.together-audio.live/privkey.pem
```
Restart Coturn:
```bash
sudo systemctl restart coturn
```

---

## 4. Render Service A (`together-1-2zi8`) Configuration

In the [Render Dashboard](https://dashboard.render.com):
1. Navigate to Web Services → **`together-1-2zi8`** *(NOT `together-backend-77g9`)*.
2. Click **Environment**.
3. Add the following environment variables:
   - **`TURN_URLS`**:
     ```
     turn:turn.together-audio.live:3478?transport=udp,turn:turn.together-audio.live:3478?transport=tcp,turns:turn.together-audio.live:5349?transport=tcp
     ```
   - **`TURN_SECRET`**:
     ```
     <PASTE_THE_SHARED_SECRET_GENERATED_BY_SETUP_SCRIPT>
     ```
4. Click **Save Changes**. Render will automatically restart `together-1-2zi8`.

---

## 5. Verification Protocol

### Step 1: Backend Health
```bash
curl -s "https://together-1-2zi8.onrender.com/api/health"
```
*Expected output*:
```json
{
  "turnConfigured": true,
  "turnType": "ephemeral-hmac"
}
```

### Step 2: Client ICE Server Credentials
```bash
curl -s "https://together-1-2zi8.onrender.com/api/ice-servers"
```
*Expected output*: Returns the 4 default STUN servers plus the Coturn relay servers with ephemeral time-stamped `username` and HMAC `credential` without exposing `TURN_SECRET`.

### Step 3: Cross-Network WebRTC Media Flow
1. Connect Host to desktop Wi-Fi and open `/host`.
2. Connect Listener to mobile cellular data (LTE/5G) and join via `/listen/ROOM-XXXX`.
3. Open `chrome://webrtc-internals` in Chrome:
   - Locate the active `RTCPeerConnection`.
   - Verify `selectedCandidatePair` has `candidateType: "relay"`.
   - Verify `bytesReceived` and `bytesSent` continuously increment.
   - Confirm clear audio playback on the mobile listener.
