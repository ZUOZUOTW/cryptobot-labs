#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_DIR="${1:-}"
if [[ "${EUID}" -ne 0 ]]; then echo "Run as root through SSM." >&2; exit 1; fi
if [[ -z "${RELEASE_DIR}" || ! -f "${RELEASE_DIR}/main.js" || ! -f "${RELEASE_DIR}/main.js.sha256" ]]; then
  echo "Usage: install-release.sh /path/to/verified-release" >&2; exit 1
fi
command -v node >/dev/null
command -v caddy >/dev/null
(cd "${RELEASE_DIR}" && sha256sum --check main.js.sha256)
node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${node_major}" -lt 22 ]]; then echo "Node.js 22 or newer is required." >&2; exit 1; fi

getent group cryptobot >/dev/null || groupadd --system cryptobot
id cryptobot >/dev/null 2>&1 || useradd --system --gid cryptobot --home-dir /nonexistent --shell /sbin/nologin cryptobot
getent group caddy >/dev/null || groupadd --system caddy
id caddy >/dev/null 2>&1 || useradd --system --gid caddy --home-dir /var/lib/caddy --shell /sbin/nologin caddy
install -d -o root -g cryptobot -m 0750 /opt/cryptobot-labs/executor
install -d -o root -g caddy -m 0750 /etc/caddy
install -d -o caddy -g caddy -m 0750 /var/lib/caddy
install -o root -g cryptobot -m 0550 "${RELEASE_DIR}/main.js" /opt/cryptobot-labs/executor/main.js
install -o root -g root -m 0644 "${RELEASE_DIR}/cryptobot-executor.service" /etc/systemd/system/cryptobot-executor.service
install -o root -g root -m 0644 "${RELEASE_DIR}/caddy.service" /etc/systemd/system/caddy.service
install -o root -g root -m 0644 "${RELEASE_DIR}/Caddyfile" /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable cryptobot-executor caddy
systemctl restart cryptobot-executor
for _attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:8080/healthz >/dev/null; then break; fi
  sleep 0.5
done
curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null
systemctl restart caddy
echo "Executor release installed. Verify /readyz before enabling public HTTPS ingress."
