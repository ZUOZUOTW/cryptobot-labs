#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly OUTPUT="${ROOT}/release/executor"
readonly NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
readonly SOURCE_REVISION="${EXECUTOR_SOURCE_REVISION:-$(git -C "${ROOT}" rev-parse HEAD)}"
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Set NODE_BIN to an executable Node.js 22+ binary." >&2
  exit 1
fi
if [[ ! "${SOURCE_REVISION}" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Executor source revision must be a full Git commit SHA." >&2
  exit 1
fi
cd "${ROOT}"
pnpm --filter @cryptobot-labs/executor build
set +e
smoke_output="$(env -i PATH="${PATH}" NODE_ENV=production "${NODE_BIN}" apps/executor/dist/main.js 2>&1)"
smoke_status=$?
set -e
if [[ "${smoke_status}" -eq 0 || "${smoke_output}" != *"EXECUTOR_SHARD_ID is required"* ]]; then
  echo "Executor bundle smoke test failed before configuration validation." >&2
  exit 1
fi
install -d -m 0750 "${OUTPUT}"
install -m 0550 apps/executor/dist/main.js "${OUTPUT}/main.js"
install -m 0550 infra/aws-executor/runtime/install-release.sh "${OUTPUT}/install-release.sh"
install -m 0440 infra/aws-executor/runtime/cryptobot-executor.service "${OUTPUT}/cryptobot-executor.service"
install -m 0440 infra/aws-executor/runtime/caddy.service "${OUTPUT}/caddy.service"
install -m 0440 infra/aws-executor/runtime/Caddyfile "${OUTPUT}/Caddyfile"
printf 'EXECUTOR_BUILD_REVISION=%s\n' "${SOURCE_REVISION}" > "${OUTPUT}/release.env"
chmod 0440 "${OUTPUT}/release.env"
(cd "${OUTPUT}" && shasum -a 256 main.js > main.js.sha256)
echo "Executor release prepared at ${OUTPUT}"
