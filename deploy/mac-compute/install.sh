#!/bin/bash
# Installs the NutriAI Mac compute worker as a launchd agent, so it starts at
# login and is restarted if it ever exits.
#
#   deploy/mac-compute/install.sh [server-url]
#
# Safe to re-run: it keeps the existing token and reloads the agent. Re-run it
# after upgrading Node (the agent records the absolute path of `node`).
set -euo pipefail

LABEL="com.nutriai.compute"
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="$HOME/.nutriai-compute"
CONFIG="$STATE/config.env"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVER_URL="${1:-https://nutriai-app.up.railway.app}"

NODE_BIN="$(command -v node || true)"
CLAUDE_BIN="$(command -v claude || true)"
[ -n "$NODE_BIN" ] || { echo "node not found on PATH" >&2; exit 1; }
[ -n "$CLAUDE_BIN" ] || { echo "claude not found on PATH — install Claude Code and sign in first" >&2; exit 1; }

mkdir -p "$STATE/work" "$HOME/Library/LaunchAgents"
chmod 700 "$STATE"

# The worker is copied out of the repo so that checking out another branch, or
# moving the repo, cannot change or break what launchd runs.
cp "$HERE/worker.mjs" "$HERE/mcp-tools.mjs" "$STATE/"

if [ -f "$CONFIG" ] && grep -q '^NUTRIAI_COMPUTE_TOKEN=' "$CONFIG"; then
  TOKEN="$(grep '^NUTRIAI_COMPUTE_TOKEN=' "$CONFIG" | cut -d= -f2-)"
  NEW_TOKEN=0
else
  TOKEN="$(openssl rand -hex 32)"
  NEW_TOKEN=1
fi

# Keep any tuning the owner has added; rewrite only the lines this script owns.
TMP="$(mktemp)"
if [ -f "$CONFIG" ]; then
  grep -v -E '^(NUTRIAI_SERVER_URL|NUTRIAI_COMPUTE_TOKEN|CLAUDE_BIN)=' "$CONFIG" > "$TMP" || true
else
  cat > "$TMP" <<'EOF'
# Optional tuning (defaults shown):
# NUTRIAI_MODEL_FAST=haiku
# NUTRIAI_MODEL_ACCURATE=sonnet
# NUTRIAI_CONCURRENCY=2
EOF
fi
{
  echo "NUTRIAI_SERVER_URL=$SERVER_URL"
  echo "NUTRIAI_COMPUTE_TOKEN=$TOKEN"
  echo "CLAUDE_BIN=$CLAUDE_BIN"
  cat "$TMP"
} > "$CONFIG"
rm -f "$TMP"
chmod 600 "$CONFIG"

# caffeinate -s keeps the Mac awake while the worker runs, on AC power only: a
# sleeping Mac answers nothing, but draining a battery to stay up is worse.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>set -a; . "$CONFIG"; set +a; exec /usr/bin/caffeinate -s "$NODE_BIN" "$STATE/worker.mjs"</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):$(dirname "$CLAUDE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>WorkingDirectory</key><string>$STATE/work</string>
  <key>StandardOutPath</key><string>$STATE/worker.log</string>
  <key>StandardErrorPath</key><string>$STATE/worker.log</string>
</dict>
</plist>
EOF

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# bootout returns before the old worker has finished exiting, and bootstrapping
# over it fails with an unhelpful "Input/output error". Wait for it to be gone.
for _ in $(seq 1 40); do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.25
done
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

echo "Installed and started $LABEL -> $SERVER_URL"
echo "  log:    $STATE/worker.log"
echo "  config: $CONFIG"
if [ "$NEW_TOKEN" = 1 ]; then
  echo
  echo "A new worker token was generated. The server must be given the same value"
  echo "as MAC_COMPUTE_TOKEN before it will hand out jobs. It is in $CONFIG"
  echo "(NUTRIAI_COMPUTE_TOKEN); it is not printed here on purpose."
fi
