#!/bin/bash
# Setup script for Claude Code cloud sessions.
#
# Paste into: claude.ai/code -> environment selector (cloud icon) -> settings
#             -> "Setup script". It is NOT read from the repo; this file is
#             just where the source of truth lives so it can be reviewed.
#
# Contract (docs/en/cloud-environments): runs as root on Ubuntu 24.04, before
# Claude Code launches, once per environment cache (~7 days or on edit). Must
# exit 0 or the session fails to start, and finish inside ~5 minutes.
#
# Skills come from the repo's .claude/settings.json. Plugin marketplaces and
# the plugins themselves do not: see the two blocks near the bottom for why
# both the registry and the install have to happen here.

set -x

# gh: not pre-installed, but /commit-commands, /triage and the issue-tracker
# skills shell out to it. xvfb + Chromium runtime libs: Playwright drives a
# real Electron window in `npm run test:e2e`.
apt-get update -y || true
apt-get install -y --no-install-recommends \
  gh xvfb libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
  libgbm1 libasound2t64 libgtk-3-0t64 libxss1 || true

# Node 24. The VM ships 20/21/22 via nvm; pin to match CI (and better-sqlite3's
# `engines: node >=22`) before installing.
for d in "$NVM_DIR" /usr/local/nvm /usr/local/share/nvm /root/.nvm /opt/nvm; do
  if [[ -s "$d/nvm.sh" ]]; then export NVM_DIR="$d"; . "$d/nvm.sh"; break; fi
done
if command -v nvm >/dev/null 2>&1; then
  nvm install 24 || true
  nvm alias default 24 || true
  nvm use 24 || true
fi

# GitNexus, globally: .mcp.json runs `gitnexus mcp`, and a global install is
# what the CLI's own resolver prefers (npx on npm 11 hits the arborist crash).
# The index itself is gitignored, so scripts/gitnexus-autoindex.mjs
# builds it in the background on the first cloud session.
npm i -g gitnexus --ignore-scripts || true

# ...and then onto a PATH the session actually has. `nvm use 24` above moved
# the global prefix under /opt/nvm/versions/node/<ver>/lib/node_modules, but
# nvm rewrites PATH only for THIS script's shell. The session's shell keeps
# /opt/node22/bin and never sees that bin dir, so `gitnexus` came back
# `command not found` and .mcp.json's `command: "gitnexus"` had nothing to
# spawn — the install succeeded and was invisible anyway. /usr/local/bin is on
# PATH in both shells. Running under either Node is fine: gitnexus declares
# `engines: node >=22` and the VM's non-nvm Node is 22.22.2.
gn="$(npm root -g 2>/dev/null)/gitnexus/dist/cli/index.js"
if [[ -f "$gn" ]]; then
  ln -sf "$gn" /usr/local/bin/gitnexus
else
  echo "WARNING: gitnexus not found at $gn — CLI and .mcp.json will not resolve"
fi

# Warm node_modules into the environment snapshot (the Electron download is
# the slow part). The clone's location is not
# documented, so find it rather than assume.
pkg=$(find /home /workspace /root /srv -maxdepth 4 -name package.json \
        -not -path '*/node_modules/*' 2>/dev/null | head -1)
if [[ -n "$pkg" ]]; then
  cd "$(dirname "$pkg")" && npm ci --ignore-scripts || true
fi

# Plugin marketplaces, pre-seeded.
#
# `extraKnownMarketplaces` in .claude/settings.json does NOT take effect in a
# cloud session. Registering a third-party marketplace needs a one-time trust
# approval, and a headless session has nobody to collect it from, so both
# entries are skipped silently — `known_marketplaces.json` ends up holding
# only claude-plugins-official, and the `enabledPlugins` keys that qualify
# against them (`ponytail@ponytail`, `mattpocock-skills@mattpocock`) resolve
# to nothing. No error is printed; the plugins are just absent.
#
# Claude Code reads the registry when it launches, so a SessionStart hook is
# already too late — this setup script is the only lever that lands before it.
# Cloning + registering by hand is what the trust prompt would have done.
#
# Idempotent: re-running fast-forwards each clone and rewrites only its own
# registry entries, leaving claude-plugins-official untouched.
CLAUDE_HOME="${HOME:-/root}/.claude"
MARKETPLACE_DIR="$CLAUDE_HOME/plugins/marketplaces"
mkdir -p "$MARKETPLACE_DIR"

for spec in "ponytail=https://github.com/DietrichGebert/ponytail" \
            "mattpocock=https://github.com/mattpocock/skills"; do
  name="${spec%%=*}"
  url="${spec#*=}"
  dest="$MARKETPLACE_DIR/$name"
  if [[ -d "$dest/.git" ]]; then
    git -C "$dest" fetch --depth 1 origin HEAD && \
      git -C "$dest" reset --hard FETCH_HEAD || true
  else
    git clone --depth 1 "$url" "$dest" || true
  fi
  # A marketplace without this manifest will not load; say so rather than
  # leaving behind the same silent no-op this block exists to fix.
  [[ -f "$dest/.claude-plugin/marketplace.json" ]] || \
    echo "WARNING: $name cloned without .claude-plugin/marketplace.json — plugin will not load"
done

node -e '
const fs = require("node:fs");
const path = require("node:path");
const claudeHome = process.argv[1];
const registry = path.join(claudeHome, "plugins", "known_marketplaces.json");
const repos = { ponytail: "DietrichGebert/ponytail", mattpocock: "mattpocock/skills" };
let known = {};
try { known = JSON.parse(fs.readFileSync(registry, "utf8")); } catch {}
for (const [name, repo] of Object.entries(repos)) {
  known[name] = {
    source: { source: "github", repo },
    installLocation: path.join(claudeHome, "plugins", "marketplaces", name),
    lastUpdated: new Date().toISOString(),
  };
}
fs.mkdirSync(path.dirname(registry), { recursive: true });
fs.writeFileSync(registry, JSON.stringify(known, null, 2));
console.log("registered marketplaces:", Object.keys(known).join(", "));
' "$CLAUDE_HOME" || true

# Plugins, actually installed.
#
# Registering a marketplace is not installing anything from it, and nothing in
# a cloud session ever runs the install: `enabledPlugins` in
# .claude/settings.json only enables plugins that are already installed, so
# `installed_plugins.json` stays `{"plugins": {}}` and every skill from both
# marketplaces is absent — the same silent no-op, one step further along, that
# the registry block above exists to fix.
#
# Non-interactive now that the registry is seeded: the trust approval is a
# property of ADDING a marketplace, not of installing from a known one.
# `timeout` because this runs before the session starts and a hang here fails
# the whole launch.
#
# Idempotent: re-installing an already-installed plugin is a no-op.
if command -v claude >/dev/null 2>&1; then
  for plugin in ponytail@ponytail mattpocock-skills@mattpocock; do
    timeout 120 claude plugin install "$plugin" --scope user || \
      echo "WARNING: could not install $plugin — its skills will be missing"
  done
  claude plugin list || true
else
  echo "WARNING: claude CLI not on PATH — plugins not installed"
fi

exit 0
