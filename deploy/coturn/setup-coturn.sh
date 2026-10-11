#!/usr/bin/env bash
# ==============================================================================
# TOGETHER — Production Coturn TURN Relay Setup Script for Ubuntu/Debian VPS
# ==============================================================================
# Automated, idempotent configuration of Coturn with RFC 5766 shared-secret auth.
# ==============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "[ERROR] This script must be run as root: sudo ./setup-coturn.sh <turn-domain> [external-ip] [--rotate-secret]"
   exit 1
fi

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
    echo "Usage: sudo ./setup-coturn.sh <turn-domain> [external-ip] [--rotate-secret]"
    echo "Example: sudo ./setup-coturn.sh turn.together-audio.live"
    exit 1
fi

# Detect External Public IP
EXTERNAL_IP="${2:-}"
if [[ -z "$EXTERNAL_IP" || "$EXTERNAL_IP" == "--rotate-secret" ]]; then
    EXTERNAL_IP=$(curl -s https://api.ipify.org || curl -s https://ifconfig.me || hostname -I | awk '{print $1}')
fi

# Detect Local Interface IP (for 1:1 NAT in AWS EC2, GCP, Oracle Cloud)
LOCAL_IP=$(hostname -I | awk '{print $1}')
if [[ -n "$LOCAL_IP" && "$LOCAL_IP" != "$EXTERNAL_IP" ]]; then
    EXTERNAL_IP_DIRECTIVE="external-ip=${EXTERNAL_IP}/${LOCAL_IP}"
    echo "[1/6] Detected 1:1 NAT environment. Configured: external-ip=${EXTERNAL_IP}/${LOCAL_IP}"
else
    EXTERNAL_IP_DIRECTIVE="external-ip=${EXTERNAL_IP}"
    echo "[1/6] Detected Public IP: ${EXTERNAL_IP}"
fi

echo "[2/6] Configuring TURN Domain: ${DOMAIN}"

echo "[3/6] Updating packages and installing Coturn, Certbot & UFW..."
apt-get update -y
apt-get install -y coturn certbot openssl ufw

echo "[4/6] Configuring UFW Firewall for WebRTC TURN relay..."
# Protect existing SSH port
SSH_PORT=$(ss -tlnp 2>/dev/null | grep sshd | awk '{print $4}' | awk -F':' '{print $NF}' | head -n1 || echo 22)
ufw allow "${SSH_PORT:-22}/tcp"
ufw allow 80/tcp       # Certbot HTTP-01 challenge
ufw allow 443/tcp      # HTTPS / TLS
ufw allow 3478/tcp     # TURN standard TCP
ufw allow 3478/udp     # TURN standard UDP
ufw allow 5349/tcp     # TURNS TLS TCP
ufw allow 5349/udp     # TURNS TLS UDP
ufw allow 49152:65535/udp # WebRTC media relay port range
ufw --force enable

# Idempotency check: Retain existing shared secret unless --rotate-secret is requested
ROTATE_SECRET=false
if [[ "${3:-}" == "--rotate-secret" || "${2:-}" == "--rotate-secret" ]]; then
    ROTATE_SECRET=true
fi

if [[ -f /etc/turnserver.conf ]] && grep -q "^static-auth-secret=" /etc/turnserver.conf && [[ "$ROTATE_SECRET" == false ]]; then
    SHARED_SECRET=$(grep "^static-auth-secret=" /etc/turnserver.conf | head -n1 | cut -d'=' -f2)
    echo "[5/6] Retaining existing RFC 5766 static-auth-secret from /etc/turnserver.conf."
else
    SHARED_SECRET=$(openssl rand -hex 32)
    echo "[5/6] Generated fresh RFC 5766 shared secret: 32-byte cryptographically secure hex."
fi

# TLS Certificate Detection
TLS_CONFIG=""
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
if [[ -f "$CERT_PATH" && -f "$KEY_PATH" ]]; then
    echo "[INFO] Detected valid Let's Encrypt certificates for ${DOMAIN}. Enabling TURNS TLS."
    chmod -R 755 /etc/letsencrypt/archive /etc/letsencrypt/live || true
    TLS_CONFIG="cert=${CERT_PATH}
pkey=${KEY_PATH}"
fi

cat <<EOF > /etc/turnserver.conf
# ==============================================================================
# TOGETHER — Production Coturn Configuration
# ==============================================================================
listening-ip=0.0.0.0
${EXTERNAL_IP_DIRECTIVE}
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535

realm=${DOMAIN}
server-name=together-turn

# RFC 5766 REST API Shared Secret Authentication
use-auth-secret
static-auth-secret=${SHARED_SECRET}

lt-cred-mech
fingerprint

# Security Hardening & Abuse Controls (SSRF, metadata, private subnet blocks)
no-loopback-peers
no-multicast-peers
no-cli
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=::1
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff

proc-user=turnserver
proc-group=turnserver

${TLS_CONFIG}

syslog
verbose
no-stdout-log
stale-nonce=600
EOF

# Ensure service daemon is enabled in /etc/default/coturn
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn || true

systemctl restart coturn
systemctl enable coturn

echo "[6/6] Coturn setup complete and active!"
echo "=============================================================================="
echo "  TOGETHER RENDER CONFIGURATION (Web Service: together-1-2zi8)"
echo "=============================================================================="
echo "Configure these Environment Variables on Render Web Service together-1-2zi8:"
echo ""
if [[ -n "$TLS_CONFIG" ]]; then
    echo "TURN_URLS: turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp,turns:${DOMAIN}:5349?transport=tcp"
else
    echo "TURN_URLS: turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp"
fi
echo "TURN_SECRET: ${SHARED_SECRET}"
echo "=============================================================================="
