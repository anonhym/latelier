import { expect, type Page } from '@playwright/test';

export class NewConnectionPage {
  private readonly win: Page;

  constructor(win: Page) {
    this.win = win;
  }

  // Footer action buttons (always visible in footer bar)
  get testButton() { return this.win.getByRole('button', { name: /Test connection/i }); }
  get saveButton() { return this.win.getByRole('button', { name: /^Save/i }); }
  get cancelButton() { return this.win.getByRole('button', { name: 'Cancel' }); }

  // General tab fields (by placeholder — inputs have no aria-label)
  get nameInput() { return this.win.getByPlaceholder('My MongoDB Server'); }
  get hostnameInput() { return this.win.getByPlaceholder('cluster.mongodb.net'); }
  get portInput() { return this.win.getByPlaceholder('27017'); }

  // URI paste — button text toggles: "Paste URI" ↔ "Use fields"
  get pasteUriToggle() { return this.win.getByRole('button', { name: /Paste URI|Use fields/i }); }
  get uriInput() { return this.win.getByPlaceholder('mongodb+srv://user:pass@cluster.mongodb.net/db'); }
  get applyUriButton() { return this.win.getByRole('button', { name: 'Apply' }); }

  // Test result feedback area (role="alert" for errors, or inline text for success)
  get testStatus() { return this.win.locator('[role="alert"]').last(); }

  // Back link / cancel — label is 'Data View' when creating, 'Connection' when
  // editing (NewConnection.tsx returns to the deep detail screen on edit).
  get backLink() { return this.win.getByRole('button', { name: /^(Data View|Connection)$/ }); }

  /** Click a form tab by name ('General' | 'Auth' | 'TLS' | 'SSH' | 'Advanced'). */
  async clickTab(name: string) {
    await this.win.getByRole('button', { name, exact: true }).first().click();
  }

  /** Select a connection type option by visible text (e.g., 'Standard (mongodb://)') */
  async selectConnectionType(text: string) {
    await this.win.getByRole('combobox').first().selectOption({ label: text });
  }

  /** Select an auth mechanism option by visible text (e.g., 'None') */
  async selectAuthMechanism(text: string) {
    await this.clickTab('Auth');
    await this.win.getByRole('combobox').first().selectOption({ label: text });
  }

  async waitVisible() {
    await expect(this.testButton).toBeVisible({ timeout: 5000 });
  }
}
