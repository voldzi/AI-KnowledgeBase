import { expect, test } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";
const approved = { collectionId: "cz-statistics", revision: "approved-r1", displayName: "Statistické zdroje schválené pro AKB",
  authorityDisplayName: "Český statistický úřad", ownerDisplayName: "Eva Správcová", gestorDisplayName: "Oddělení znalostí",
  reviewRuleLabel: "Roční kontrola", profile: { id: "akb.official-public-reference", revision: "1" }, tlp: "TLP:CLEAR" };

test("PS-01 unavailable central approval blocks import, refresh provides a named picker", async ({ page }, testInfo) => {
  let attempts = 0;
  await page.route("**/api/public-sources/collections", (route) => {
    attempts++;
    return route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1
      ? { error: { code: "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE", message: "Schválené kolekce nejsou nyní dostupné." } }
      : { collections: [approved] } });
  });
  await page.goto(`${basePath}/sources`);
  await expect(page.getByRole("status").filter({ hasText: "Schválené kolekce nejsou nyní dostupné." })).toBeVisible();
  await expect(page.getByLabel("Schválená kolekce", { exact: true })).toBeDisabled();
  for (const button of await page.getByRole("button", { name: "Synchronizovat kolekci", exact: true }).all()) await expect(button).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("approval-unavailable.png"), fullPage: true });
  await page.getByRole("button", { name: "Obnovit schválení" }).click();
  const picker = page.getByLabel("Schválená kolekce", { exact: true });
  await expect(picker).toBeEnabled();
  await picker.selectOption("cz-statistics");
  await expect(page.getByText("Eva Správcová", { exact: true })).toBeVisible();
  await expect(page.getByText("Oddělení znalostí", { exact: true })).toBeVisible();
  await expect(page.locator(".public-source-card")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("approved-picker.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".public-sources__approval").scrollIntoViewIfNeeded();
  await expect(picker).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("approved-picker-mobile.png"), fullPage: true });
});

test("PS-02 selected revision is sent without authority fields and stale approval stops the queue", async ({ page }) => {
  await page.route("**/api/public-sources/collections", (route) => route.fulfill({ json: { collections: [approved] } }));
  await page.route("**/api/public-sources/discover", (route) => route.fulfill({ json: {
    collectionId: "cz-statistics", pagesVisited: 1, warnings: [],
    candidates: Array.from({ length: 5 }, (_, index) => ({ title: `Statistika ${index}`, sourceUrl: `https://csu.gov.cz/katalog-${index}`,
      canonicalUrl: `https://csu.gov.cz/katalog-${index}` })),
  } }));
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/public-sources/sync", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: { code: "PUBLIC_SOURCE_APPROVAL_STALE", message: "Schválení se změnilo." } } });
  });
  await page.goto(`${basePath}/sources`);
  await page.getByLabel("Schválená kolekce", { exact: true }).selectOption("cz-statistics");
  await page.getByRole("button", { name: "Načíst katalog", exact: true }).click();
  await page.getByRole("button", { name: "Synchronizovat kolekci", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Schválení příjmu je nutné znovu ověřit" })).toBeVisible();
  await expect(page.getByLabel("Schválená kolekce", { exact: true })).toBeDisabled();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.length).toBeLessThanOrEqual(2); // Only already in-flight workers; no subsequent candidates.
  for (const request of requests) {
    expect(request.collection_revision).toBe("approved-r1");
    expect(request.information_policy).toBeUndefined();
    expect(request.document_profile).toBeUndefined();
    expect(request.sourceGovernedResourceId).toBeUndefined();
  }
});
