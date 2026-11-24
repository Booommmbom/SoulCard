#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "=============================================================="
echo "  SoulCard — One-Click Lazy Launcher (Zero Deps · Cloud-First)"
echo "  Supports Claude / GPT / Gemini / Grok / DeepSeek / Any Relay"
echo "=============================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[Error] Node.js 20+ is required. Download at: https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "[Error] Node.js 20+ is required (found v$(node -v)). Download at: https://nodejs.org/"
  exit 1
fi

echo "[Starting] Zero npm install needed. Opening Web Studio in browser..."
exec node src/runtime/web-server.mjs --open
