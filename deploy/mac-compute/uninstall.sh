#!/bin/bash
# Stops and removes the NutriAI Mac compute worker. The config (and its token)
# in ~/.nutriai-compute is left in place; delete that directory to forget it.
set -euo pipefail

LABEL="com.nutriai.compute"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Removed $LABEL. AI requests now go to the cloud provider (or their fallbacks)."
