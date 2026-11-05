#!/usr/bin/env bash
# Provision a fresh Ubuntu 24.04 box on Oracle Cloud for the rascals stack.
# Run as root over SSH after the instance is reachable.
set -euo pipefail

# Two firewall layers have to allow 80/443, and Oracle configures both against
# you: the VCN security list (fixed in the console) and OS-level iptables rules
# baked into the Ubuntu image, which drop everything except SSH. Caddy will sit
# in a certificate-retry loop forever if you only fix one.
if command -v netfilter-persistent >/dev/null 2>&1; then
  iptables -A INPUT -p tcp --dport 80 -j ACCEPT
  iptables -A INPUT -p tcp --dport 443 -j ACCEPT
  netfilter-persistent save
  echo "opened 80/443 in the OS firewall"
else
  echo "netfilter-persistent absent; check the OS firewall manually before Caddy"
fi

apt-get update
apt-get install -y --no-install-recommends \
  docker.io docker-compose-v2 git curl sqlite3 rclone ca-certificates
systemctl enable --now docker

# Cheap insurance: a runaway poller gets slow instead of being OOM-killed, and
# the other projects on this box stay alive.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

mkdir -p /opt/rascals
echo
echo "Provisioned. Next:"
echo "  1. git clone <your repo> /opt/rascals/repo"
echo "  2. cp /opt/rascals/repo/deploy/.env.example /opt/rascals/repo/deploy/.env"
echo "  3. fill in the hostname and JACKPOT_PERPS_SECRET, then:"
echo "     cd /opt/rascals/repo/deploy && docker compose up -d --build"
