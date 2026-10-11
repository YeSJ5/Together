#!/usr/bin/env bash
# ==============================================================================
# TOGETHER — Automated Coturn TURN Server Setup Script for Ubuntu/Debian VPS
# ==============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "[ERROR] This script must be run as root (sudo ./setup-coturn.sh)"
   exit 1
fi

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
    echo "Usage: sudo ./setup-coturn.sh <turn-domain> [external-ip]"
    echo "Example: sudo ./setup-coturn.sh turn.together-audio.live"
    exit 1
fi

EXTERNAL_IP="${2:-$(curl -s https://api.ipify.org || curl -s https://ifconfig.me)}"
echo "[1/6] Detected External IP: ${EXTERNAL_IP}"
echo "[2/6] Configuring TURN Domain: ${DOMAIN}"

echo "[3/6] Updating packages and installing Coturn & Certbot..."
apt-get update -y
apt-get install -y coturn certbot openssl ufw

echo "[4/6] Configuring UFW Firewall for WebRTC TURN relay..."
ufw allow 22/tcp       # SSH
ufw allow 80/tcp       # Certbot HTTP-01 challenge
ufw allow 443/tcp      # HTTPS / TLS
ufw allow 3478/tcp     # TURN standard TCP
ufw allow 3478/udp     # TURN standard UDP
ufw allow 5349/tcp     # TURNS TLS TCP
ufw allow 5349/udp     # TURNS TLS UDP
ufw allow 49152:65535/udp # WebRTC media relay port range
ufw --force enable

echo "[5/6] Generating strong RFC 5766 shared secret..."
SHARED_SECRET=$(openssl rand -hex 32)

cat <<EOF > /etc/turnserver.conf
listening-ip=0.0.0.0
external-ip=${EXTERNAL_IP}
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535

realm=${DOMAIN}
server-name=together-turn

use-auth-secret
static-auth-secret=${SHARED_SECRET}

lt-cred-mech
fingerprint

no-loopback-peers
no-multicast-peers
no-cli
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255

syslog
verbose
no-stdout-log
stale-nonce=600
EOF

# Enable Coturn service
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn || true

systemctl restart coturn
systemctl enable coturn

echo "[6/6] Coturn setup complete and active!"
echo "=============================================================================="
echo "  TOGETHER RENDER CONFIGURATION (together-1-2zi8)"
echo "=============================================================================="
echo "Configure these Environment Variables on Render service together-1-2zi8:"
echo ""
echo "TURN_URLS: turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp"
echo "TURN_SECRET: ${SHARED_SECRET}"
echo ""
echo "If TLS certificate is acquired via certbot:"
echo "TURN_URLS: turn:${DOMAIN}:3478?transport=udp,turns:${DOMAIN}:5349?transport=tcp"
echo "=============================================================================="
