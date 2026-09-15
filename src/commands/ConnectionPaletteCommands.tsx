import { useLocation, useNavigate } from 'react-router-dom';
import { useConnections } from '../state/connections';
import { useRegisterCommands } from './useRegisterCommands';
import type { Command } from './types';

/**
 * Registers one `connection.open:<id>` / `connection.delete:<id>` /
 * `connection.edit:<id>` row per saved connection so the palette can act on
 * any of them from anywhere. Holds its own `useConnections()` subscription —
 * the cost is one extra `conn:list` call on focus, well worth keeping the
 * palette decoupled from any single page.
 *
 * X16.4 — "Switch to: X" became "Open connection → X" (§4.6). The
 * wording follows the behaviour: several Connections stay open at once, so
 * choosing one adds a server rather than replacing the one you were on.
 *
 * X16.5 — delete and edit joined open in this per-Connection shape.
 * Gating a single `connection.delete` command on the Focused Tab's Connection
 * (`PaletteContext.connectionId`) hid it exactly when a Connection was open
 * with no tab — the normal case now that a Connection can stay open tabless.
 */
export function ConnectionPaletteCommands() {
  const { connections } = useConnections();
  const navigate = useNavigate();
  const location = useLocation();

  const commands: Command[] = connections.map((conn) => ({
    id: `connection.open:${conn.id}`,
    title: `Open connection → ${conn.name}`,
    subtitle: conn.host,
    group: 'connection',
    keywords: ['connection', 'open', 'connect', conn.host],
    // The action itself lives in the Data View, which owns the Connections it
    // has open. Rather than reimplement it here (the two would drift), hand
    // the request to Workspace as a route intent; its effect calls the exact
    // `openConnection` the Connection Switcher's rows call. See Workspace.tsx
    // `openConnectionId`.
    //
    // This also navigates when the user is already on /workspace: same path,
    // new location state, so the effect re-fires and Workspace stays mounted.
    // One transport, one behaviour, every route.
    //
    // `replace` when already on /workspace — Workspace's own effect replaces
    // the intent out of location.state once it acts on it, so a PUSH here
    // would leave a second, functionally-identical history entry behind on
    // every in-Workspace switch, growing history unboundedly and making
    // back/forward (incl. a trackpad/Chromium swipe-back) a no-op. Arriving
    // from elsewhere still pushes, so back navigation lands where the user
    // actually came from.
    perform: () =>
      navigate('/workspace', {
        state: { openConnectionId: conn.id },
        replace: location.pathname === '/workspace',
      }),
  }));

  // X16.5 — one `connection.delete:<id>` / `connection.edit:<id>` per
  // saved Connection, mirroring `connection.open:<id>` above: the id is baked
  // into `perform` at creation time, not read from `PaletteContext` at call
  // time. That's what makes "a Connection is open but has no tab" (the normal
  // state) not lose the command, and makes a command's gate and its target
  // structurally unable to disagree — the bug class this was built to stop
  // from coming back by another route.
  //
  // Same route-intent handoff as `openConnectionId`: this component is
  // mounted above `<Routes>` and can't reach Workspace's local
  // `openDeleteConnectionModal` / `openEditConnectionModal` state directly.
  // See Workspace.tsx's `deleteConnectionId` / `editConnectionId` effects.
  const deleteCommands: Command[] = connections.map((conn) => ({
    id: `connection.delete:${conn.id}`,
    title: `Delete connection → ${conn.name}`,
    subtitle: conn.host,
    group: 'connection',
    keywords: ['connection', 'delete', 'remove', 'drop', conn.host],
    perform: () =>
      navigate('/workspace', {
        state: { deleteConnectionId: conn.id },
        replace: location.pathname === '/workspace',
      }),
  }));
  const editCommands: Command[] = connections.map((conn) => ({
    id: `connection.edit:${conn.id}`,
    title: `Edit connection → ${conn.name}`,
    subtitle: conn.host,
    group: 'connection',
    keywords: ['connection', 'edit', 'settings', conn.host],
    perform: () =>
      navigate('/workspace', {
        state: { editConnectionId: conn.id },
        replace: location.pathname === '/workspace',
      }),
  }));

  useRegisterCommands(
    [...commands, ...deleteCommands, ...editCommands],
    [connections, navigate, location.pathname],
  );

  return null;
}
