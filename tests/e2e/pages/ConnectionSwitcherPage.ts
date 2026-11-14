import { expect, type Page } from '@playwright/test';

/**
 * The Connection Switcher — the TitleBar popover, its per-row
 * actions, and its expanded Connections table. The one
 * canonical way to list, search, switch, and manage Connections since the
 * standalone `/connections` list screen retired (ADR 0001).
 *
 * Owned by `WorkspacePage` (the Data View's page object) via its `switcher`
 * property — specs construct it through that. Cross-cutting assertion
 * helpers that only need the Switcher (e.g. `uiAsserts.ts`'s
 * `expectStatusDot`) may construct it directly from a `Page`, since they
 * have no reason to pull in the rest of the Data View surface.
 */
export class ConnectionSwitcherPage {
  private readonly win: Page;

  constructor(win: Page) {
    this.win = win;
  }

  // scoped to the TitleBar (`role="banner"`): when no Connection is
  // Active, the Data View's empty state renders its own `variant="cta"`
  // Switcher trigger with the same accessible name, so an unscoped query
  // matches two buttons.
  get trigger() { return this.win.getByRole('banner').getByRole('button', { name: /^Connection:/ }); }
  get listbox() { return this.win.locator('[role="listbox"][aria-label="Connections"]'); }
  get manageButton() { return this.win.getByRole('button', { name: 'Manage all' }); }
  // With no saved Connection the Data View is the welcome canvas (C03 §13.1):
  // no title-bar Switcher, so its `Connection string` field is the anchor.
  get welcomeField() { return this.win.getByTestId('welcome-canvas').getByRole('textbox', { name: 'Connection string', exact: true }); }
  // The search field renders role="combobox" (Mantine's Popover.Target
  // wrapper adds aria-haspopup="listbox"), not "textbox".
  get searchInput() { return this.win.getByRole('combobox', { name: 'Search connections' }); }

  /**
   * The trigger named for a specific Connection. Banner-scoped for the same
   * reason `trigger` is (see its comment).
   *
   * X16.4 — this names the **Focused Tab's** Connection, so it only
   * resolves when a tab on that Connection is open. It is no longer a way to
   * wait for a connect to land: opening a Connection opens no tab (§4.6). Use
   * `expectStatusDot(win, name, 'connected')` for that.
   */
  triggerNamed(connectionName: string) {
    return this.win.getByRole('banner').getByRole('button', { name: `Connection: ${connectionName}` });
  }

  item(name: string) {
    return this.listbox.locator(`[role="option"][aria-label="${name}"]`);
  }

  /** Opens the Switcher popover if it isn't already open. */
  async ensureOpen() {
    if (await this.listbox.isVisible().catch(() => false)) return;
    await this.trigger.click();
    await expect(this.listbox).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Waits for the popover to fully leave the DOM after an action that closes
   * it (select / manage / edit / delete / add). Mantine's `Popover` keeps the
   * dropdown mounted through its exit transition, so a bare `.click()` can
   * return while the search field — a `role="combobox"` — is still present
   * and racing whatever opens next (e.g. `getByRole('combobox').first()` in
   * a just-opened Connection form landing on the dying popover instead of
   * the form's own field).
   */
  private async waitClosed() {
    await expect(this.listbox).toHaveCount(0, { timeout: 5000 });
  }

  /**
   * Opens the disconnect-confirmation dialog via the row's `⋯` menu,
   * which only renders on the highlighted row, so this hovers the row first
   * to highlight it. (Connect is just a plain row click — use `select(name)`
   * for that.) Spec §4.6 — Disconnect confirms first, naming the
   * Connection and its tab count; the caller still has to confirm the
   * dialog, same convention as `delete()` below.
   */
  async disconnect(name: string) {
    await this.rowMenuItem(name, 'Disconnect');
  }

  /**
   * Status rides the row-edge band, exposed as `data-status` on a
   * descendant of the row rather than `aria-label` — a deliberate a11y
   * choice (see `ConnectionSwitcher.tsx`'s `ConnectionRow`: status is
   * conveyed via `aria-describedby` text, not the row's name, so `data-`
   * is what's left for a purely visual/test hook).
   */
  statusDotWithValue(name: string, status: string) {
    return this.item(name).locator(`[data-status="${status}"]`);
  }

  async waitVisible() {
    // 10s, not 5s: the first e2e spec pays the cold Electron boot + first-paint
    // cost on a loaded CI runner, which can exceed 5s. Resolves as soon as the
    // popover is open, so warm runs are unaffected.
    //
    // Needs a saved Connection: with none the welcome canvas is shown and
    // there is no title-bar trigger, so zero-connection starts use `waitWelcome`.
    await expect(this.trigger).toBeVisible({ timeout: 10_000 });
    await this.ensureOpen();
  }

  /** Zero-connection start: the welcome canvas is the boot anchor. */
  async waitWelcome() {
    await expect(this.welcomeField).toBeVisible({ timeout: 10_000 });
  }

  /**
   * The full form: the welcome canvas's `Enter details manually` when no
   * Connection is saved, else the table's "+ New" (C13 §7).
   */
  async openNew() {
    if (await this.welcomeField.isVisible()) {
      await this.win.getByRole('button', { name: 'Enter details manually' }).click();
      return;
    }
    await this.openExpandedTable();
    await this.expandedTableDialog.getByRole('button', { name: '+ New', exact: true }).click();
    await expect(this.expandedTableDialog).toBeHidden();
  }

  /** Selects (and connects) a Connection — closes the popover. */
  async select(name: string) {
    await this.ensureOpen();
    await this.item(name).click();
    await this.waitClosed();
  }

  async filter(text: string) {
    await this.ensureOpen();
    await this.searchInput.fill(text);
  }

  /**
   * Hovers a row (its `⋯` only renders on the highlighted row), opens the
   * menu and clicks the named item. Menu labels are those of
   * `connectionRowMenu`.
   */
  private async rowMenuItem(name: string, item: 'Open server overview' | 'Edit…' | 'Disconnect' | 'Delete…') {
    await this.ensureOpen();
    await this.item(name).hover();
    await this.win.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
    await this.win.getByRole('menuitem', { name: item, exact: true }).click();
  }

  /** A row action that closes the popover (`Manage` / `Edit` / `Delete`). */
  private async rowAction(name: string, action: 'Manage' | 'Edit' | 'Delete') {
    const item = { Manage: 'Open server overview', Edit: 'Edit…', Delete: 'Delete…' } as const;
    await this.rowMenuItem(name, item[action]);
    await this.waitClosed();
  }

  /**
   * Opens the Connection's server tab (C05 §11) via the row menu's
   * `Open server overview`. This drives the popover's; the expanded Connections
   * table has its own, reached via `expandedTableRowMenu(name, 'Open server overview')`.
   */
  async manage(name: string) {
    await this.rowAction(name, 'Manage');
  }

  /** Opens the Connection form as a modal, prefilled, via the "Edit" row action. */
  async edit(name: string) {
    await this.rowAction(name, 'Edit');
  }

  /**
   * Opens the delete-confirmation dialog via the "Delete" row action. The
   * caller still has to confirm the dialog.
   */
  async delete(name: string) {
    await this.rowAction(name, 'Delete');
  }

  /**
   * The name of the row the keyboard highlight is on, resolved the way
   * assistive tech resolves it: `aria-activedescendant` on the search field →
   * the element with that id. `null` when nothing is highlighted.
   */
  async highlightedName(): Promise<string | null> {
    const id = await this.searchInput.getAttribute('aria-activedescendant');
    if (!id) return null;
    // Attribute selector, not `#id`: React's `useId` emits `:r1:`-style ids,
    // whose colons are CSS combinators unless escaped.
    return this.listbox.locator(`[id="${id}"]`).getAttribute('aria-label');
  }

  /**
   * The text a screen reader would read as a row's description — host and
   * status. Resolves `aria-describedby` the way AT does, so it
   * proves the wiring rather than the markup behind it.
   */
  async describedText(connectionName: string): Promise<string> {
    const ids = await this.item(connectionName).getAttribute('aria-describedby');
    if (!ids) return '';
    const texts = await Promise.all(
      ids
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => this.win.locator(`[id="${id}"]`).textContent()),
    );
    return texts.join(' ').trim();
  }

  // the Switcher's expanded Connections table.
  // Exact: Playwright matches names by substring, and dialogs stacked on the
  // table ("Export Connections") would match too.
  get expandedTableDialog() { return this.win.getByRole('dialog', { name: 'Connections', exact: true }); }
  get expandedTableSearch() {
    return this.expandedTableDialog.getByRole('textbox', { name: /search connections/i });
  }

  /** The `<tr>` for a Connection in the expanded table, found via its name cell. */
  expandedTableRow(connectionName: string) {
    return this.expandedTableDialog.locator('tr').filter({ hasText: connectionName });
  }

  /** The selected row's `Connect` button in the expanded table. */
  expandedTableConnect(connectionName: string) {
    return this.expandedTableRow(connectionName).getByRole('button', { name: 'Connect', exact: true });
  }

  /**
   * A row action in the expanded table: the selected row's `⋯` menu, the same
   * one a Switcher row carries (`connectionRowMenu`).
   */
  async expandedTableRowMenu(
    connectionName: string,
    item: 'Open server overview' | 'Edit…' | 'Disconnect' | 'Delete…',
  ) {
    await this.expandedTableRow(connectionName)
      .getByRole('button', { name: `Actions for ${connectionName}`, exact: true })
      .click();
    await this.win.getByRole('menuitem', { name: item, exact: true }).click();
  }

  /**
   * Opens the expanded table, opening the popover first if it isn't already
   * open. Expanding closes the popover — the two are never on screen together.
   *
   * Opens off the generic `Connection:` trigger rather than one named for a
   * Connection: with no tab open the trigger names the last one connected.
   */
  async openExpandedTable() {
    if (!(await this.listbox.isVisible().catch(() => false))) {
      await this.trigger.click();
    }
    // Same 10s as `ensureOpen` — kept in sync deliberately, not a typo.
    await expect(this.listbox).toBeVisible({ timeout: 10_000 });
    await this.manageButton.click();
    await expect(this.expandedTableDialog).toBeVisible({ timeout: 8000 });
    // The popover's search field is a `combobox` too; let it finish its exit
    // transition before the caller queries one (see `waitClosed`).
    await this.waitClosed();
  }
}
