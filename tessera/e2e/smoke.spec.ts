import { test, expect } from '@playwright/test';

/**
 * Core-flow smoke tests (build spec §10 workflows). These exercise the app shell,
 * store reactivity, and navigation — the closed-form design path that works
 * without the WASM FEA module. The .tsr save/load/migration path is covered by
 * the Vitest unit suite (project/tsrFile.test.ts, store/sectionLibrary.test.ts).
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/OpenSees_wp77/');
});

test('app shell and member workspace render', async ({ page }) => {
  await expect(page.getByText('Tessera').first()).toBeVisible();
  // The member workspace is the default view.
  await expect(page.getByText('Section & geometry')).toBeVisible();
  await expect(page.getByText('Materials, span & loads')).toBeVisible();
  // The default member ("Beam 1") appears in the project navigator.
  await expect(page.getByRole('button', { name: 'Beam 1' })).toBeVisible();
});

test('editing the member name updates the project navigator (store reactivity)', async ({ page }) => {
  await page.locator('#member-name').fill('E2E Beam');
  // The navigator label is driven by the store — it should reflect the rename.
  await expect(page.getByRole('button', { name: 'E2E Beam' })).toBeVisible();
});

test('editing the span keeps the results panel live', async ({ page }) => {
  const span = page.getByLabel('Span L');
  await span.fill('40');
  await expect(span).toHaveValue('40');
  // Results remain rendered (no crash on recompute).
  await expect(page.getByText('Section & geometry')).toBeVisible();
});

test('navigating to a Vierendeel panel switches the workspace and back', async ({ page }) => {
  await page.getByRole('button', { name: 'Panel 1' }).click();
  await expect(page.getByText('Panel & openings')).toBeVisible();
  // Back to the member workspace.
  await page.getByRole('button', { name: 'Beam 1' }).click();
  await expect(page.getByText('Section & geometry')).toBeVisible();
});
