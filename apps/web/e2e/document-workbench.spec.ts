import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("Document Workbench product paths", () => {
  test("DW-01 registry renders and filters controlled documents", async ({ page }) => {
    await page.goto("/documents");

    await expect(page).toHaveTitle(/AKL Platform/);
    await expect(page.getByText("Mock API režim")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Registr dokumentů" }).first()).toBeVisible();
    await expect(page.getByText("Smernice pro spravu rizene dokumentace")).toBeVisible();

    await page.getByPlaceholder("Název, ID, gestor, vlastník nebo štítek").fill("bezpecnostnich");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByText("Metodika vyjimek z bezpecnostnich pravidel")).toBeVisible();

    await page.getByLabel("Klasifikace").selectOption("restricted");
    await expect(page.getByText("Zobrazeno 1 z 4")).toBeVisible();

    await page.getByRole("button", { name: "Vyčistit" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
  });

  test("DW-06 and DW-09 detail shows workflow and locked publish gate", async ({ page }) => {
    await page.goto("/documents/doc_102");

    await expect(page.getByRole("heading", { name: "Detail dokumentu" })).toBeVisible();
    await expect(page.getByText("Metodika vyjimek z bezpecnostnich pravidel").first()).toBeVisible();

    await page.getByRole("button", { name: "Workflow" }).click();
    await expect(page.getByRole("heading", { name: "Publish gate" })).toBeVisible();
    await expect(page.getByText("Publikační akce nejsou pro tuto relaci povolené.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publikovat schválenou verzi" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Workflow tasky" })).toBeVisible();
    await expect(page.getByText("Document review required")).toBeVisible();
  });

  test("DW-08 workflow inbox records an approval decision in mock mode", async ({ page }) => {
    await page.goto("/tasks");

    await expect(page.getByRole("heading", { name: "Workflow úkoly" })).toBeVisible();
    await page.getByRole("button", { name: /Document review required/ }).click();
    await expect(page.getByRole("heading", { name: "Detail úkolu" })).toBeVisible();

    await page.getByLabel("Komentář").fill("E2E approval check");
    await page.getByRole("button", { name: "Schválit" }).click();
    await expect(page.getByRole("status")).toContainText("Rozhodnutí bylo zapsané.");
  });

  test("DW-13 knowledge chat opens cited source context", async ({ page }) => {
    await page.goto("/chat");

    await expect(page.getByRole("heading", { name: "Znalostní chat" }).first()).toBeVisible();
    await expect(page.getByText("Metodika vyjimek z bezpecnostnich pravidel").first()).toBeVisible();

    await page.getByRole("button", { name: "Otevřít citaci" }).first().click();
    await expect(page.getByText("Chunk chunk_789")).toBeVisible();
    await expect(page.getByText("Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu.")).toBeVisible();
  });

  test("DW-15 help center renders role-based guidance", async ({ page }) => {
    await page.goto("/help");

    await expect(page.getByRole("heading", { name: "Nápověda" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rychlý start" })).toBeVisible();
    await expect(page.getByText("Správce dokumentů")).toBeVisible();
    await expect(page.getByText("Vlastník / gestor")).toBeVisible();
    await expect(page.getByText("Auditor")).toBeVisible();
    await expect(page.getByText("Upload a preflight")).toBeVisible();
    await expect(page.getByText("Workflow publikace")).toBeVisible();
  });
});
