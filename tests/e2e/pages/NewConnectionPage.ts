import { expect, type Page } from '@playwright/test';

export class NewConnectionPage {
  private readonly win: Page;

  constructor(win: Page) {
    this.win = win;
  }

  // Footer action buttons (always visible in footer bar)
  get testButton() { return this.win.getByRole('button', { name: 'Test', exact: true }); }
  // Plain `Save`: `Save & connect` sits beside it, so match the name exactly.
  get saveButton() { return this.win.getByRole('button', { name: 'Save', exact: true }); }
  get saveAndConnectButton() { return this.win.getByRole('button', { name: 'Save & connect', exact: true }); }
  get cancelButton() { return this.win.getByRole('button', { name: 'Cancel' }); }

  // General tab fields (by placeholder — inputs have no aria-label)
  get nameInput() { return this.win.getByPlaceholder('My MongoDB Server'); }
  get hostnameInput() { return this.win.getByPlaceholder('localhost', { exact: true }); }
  get portInput() { return this.win.getByPlaceholder('27017', { exact: true }); }

  // The always-visible `Connection string` field above the tabs. It applies on
  // paste, blur and Enter; there is no Apply button.
  get uriInput() { return this.win.getByTestId('connection-form-uri'); }

  /** Types a URI into the Connection string field and applies it with Enter. */
  async applyUri(uri: string) {
    await this.uriInput.fill(uri);
    await this.uriInput.press('Enter');
  }

  // Test result feedback area (role="alert" for errors, or inline text for success)
  get testStatus() { return this.win.locator('[role="alert"]').last(); }

  // Back link / cancel — label is 'Data View' when creating, 'Connection' when
  // editing (NewConnection.tsx returns to the deep detail screen on edit).
  get backLink() { return this.win.getByRole('button', { name: /^(Data View|Connection)$/ }); }

  /**
   * Click a form tab by name ('General' | 'Authentication' | 'TLS / SSH' | 'Advanced').
   *
   * `role: 'tab'`, not `'button'`: X19/#59 made this strip a real tablist, so
   * the elements that used to answer to `getByRole('button')` no longer do.
   * Three e2e tests timed out here before this was updated — the component
   * suite could not see it, because the break is in this page object.
   */
  async clickTab(name: string) {
    await this.win.getByRole('tab', { name, exact: true }).first().click();
  }

  /** Select a connection type option by visible text (e.g., 'Standard (mongodb://)') */
  async selectConnectionType(text: string) {
    await this.win.getByRole('combobox').first().selectOption({ label: text });
  }

  /** Select an auth mechanism option by visible text (e.g., 'None') */
  async selectAuthMechanism(text: string) {
    await this.clickTab('Authentication');
    await this.win.getByRole('combobox').first().selectOption({ label: text });
  }

  async waitVisible() {
    await expect(this.testButton).toBeVisible({ timeout: 5000 });
  }
}
