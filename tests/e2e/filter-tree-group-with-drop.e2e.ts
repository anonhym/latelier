import { test, expect } from '@playwright/test';
import { stopAllMemoryServers } from '../helpers/e2eApp';
import { withOpenOrders } from './helpers/uiSeed';

test.afterAll(stopAllMemoryServers);

/**
 * W13 §6 / ADR 0007 addendum — with one condition at the root, the strip
 * under that row is the only drop that makes an OR of two different fields.
 * It shows only while a field is over the row, so the drag is held by hand
 * (mouse down, move, up) to cross the row and then land on the strip: a
 * single `dragTo` would never see it appear.
 */
test('a field dropped on the strip under the only condition makes an OR group with it', async () => {
  await withOpenOrders('Group With Target', [{ sku: 'apple-001', status: 'paid' }, { sku: 'banana-002', status: 'pending' }], 'banana-002', async (win, ws) => {
    await win.setViewportSize({ width: 1600, height: 1000 });
    await ws.viewTableButton.click();
    await ws.openBuilder();
    const pending = win.getByTitle(/Drag to add "status/).filter({ hasText: 'pending' });
    await pending.dragTo(win.getByLabel('Drop a field here to add a condition'));
    await expect(ws.queryBarTextarea).toHaveValue('{"status":{"$eq":"pending"}}');
    const sku = win.getByTitle(/Drag to add "sku/).filter({ hasText: 'apple-001' });
    await sku.hover();
    await win.mouse.down();
    const row = win.locator('[data-row-path="0"]');
    const rb = (await row.boundingBox())!;
    await win.mouse.move(rb.x + rb.width / 2, rb.y + 15, { steps: 8 });
    const strip = win.locator('[data-group-with="0"]');
    await expect(strip).toBeVisible();
    const sb = (await strip.boundingBox())!;
    await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 8 });
    await win.mouse.up();
    await expect(ws.queryBarTextarea).toHaveValue('{"$or":[{"status":{"$eq":"pending"}},{"sku":{"$eq":"apple-001"}}]}');
    await expect(strip).toHaveCount(0);
    // Both conditions now sit in the new group that took the row's place.
    await expect(win.locator('[data-group-path="0"] [data-row-path="0.0"]')).toBeVisible();
    await expect(win.locator('[data-group-path="0"] [data-row-path="0.1"]')).toBeVisible();
  });
});

/**
 * The strip shows over a row's bottom while a field is over it. Moving on past
 * it to the group's own "Drop a field here" strip must still land in that
 * group: the strip appearing must not move what is below the row, or a release
 * aimed where the group strip was lands in the root instead.
 */
test('the strip under a row does not move the group strip below it', async () => {
  await withOpenOrders('Group With Layout', [{ sku: 'apple-001', status: 'paid' }, { sku: 'banana-002', status: 'pending' }], 'banana-002', async (win, ws) => {
    await win.setViewportSize({ width: 1600, height: 1000 });
    await ws.viewTableButton.click();
    await ws.openBuilder();
    await win.getByRole('button', { name: 'More ways to add', exact: true }).click();
    await win.getByRole('menuitem', { name: 'Add group', exact: true }).click();
    await win.getByRole('radiogroup', { name: 'Group logic' }).nth(1).getByRole('radio', { name: 'OR', exact: true }).click();
    const groupStrip = win.locator('[data-group-path="0"]').getByText('Drop a field here', { exact: true });
    await win.getByTitle(/Drag to add "status/).filter({ hasText: 'pending' }).dragTo(groupStrip);
    await expect(win.locator('[data-row-path="0.0"]')).toBeVisible();

    const before = (await groupStrip.boundingBox())!;
    const sku = win.getByTitle(/Drag to add "sku/).filter({ hasText: 'apple-001' });
    await sku.hover();
    await win.mouse.down();
    const rb = (await win.locator('[data-row-path="0.0"]').boundingBox())!;
    await win.mouse.move(rb.x + rb.width / 2, rb.y + 15, { steps: 8 });
    await expect(win.locator('[data-group-with="0.0"]')).toBeVisible();
    expect((await groupStrip.boundingBox())!.y).toBe(before.y);
    await win.mouse.move(before.x + before.width / 2, before.y + before.height / 2, { steps: 8 });
    await win.mouse.up();

    await expect(win.locator('[data-group-path="0"] [data-row-path="0.1"]')).toBeVisible();
    await expect(ws.queryBarTextarea).toHaveValue('{"$or":[{"status":{"$eq":"pending"}},{"sku":{"$eq":"apple-001"}}]}');
  });
});
