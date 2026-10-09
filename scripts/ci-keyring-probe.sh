#!/usr/bin/env bash
# Temporary CI diagnostic: which credential store does a bare Electron pick on
# the runner, with and without an explicit --password-store?
set -uo pipefail
probe_js="$(mktemp --suffix=.cjs)"
cat > "$probe_js" <<'JS'
const { app, safeStorage } = require('electron');
app.whenReady().then(() => {
  const available = safeStorage.isEncryptionAvailable();
  console.log('PROBE ' + JSON.stringify({
    available,
    backend: safeStorage.getSelectedStorageBackend(),
    xdg: process.env.XDG_CURRENT_DESKTOP,
    bus: process.env.DBUS_SESSION_BUS_ADDRESS,
  }));
  app.quit();
});
JS
for extra in "" "--password-store=gnome-libsecret"; do
  echo "== probe with: ${extra:-<no extra flag>}"
  ELECTRON_ENABLE_LOGGING=1 timeout 60 xvfb-run --auto-servernum \
    node_modules/electron/dist/electron --no-sandbox --user-data-dir="$(mktemp -d)" \
    --enable-logging=stderr --vmodule='*key_storage*=1,*os_crypt*=1,*libsecret*=1' $extra "$probe_js" 2>&1 \
    | grep -iE "PROBE|secret|keyring|dbus|password|crypt|key_storage" | head -40
done
exit 0
