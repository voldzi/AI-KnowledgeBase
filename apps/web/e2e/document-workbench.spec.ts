import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const appBasePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";

function appPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${appBasePath}${normalized}`;
}

test.describe("Document Workbench product paths", () => {
  test("DW-01 registry renders and filters controlled documents", async ({ page }) => {
    await page.goto(appPath("/documents"));

    await expect(page).toHaveTitle(/AKB Platform/);
    await expect(page.getByRole("heading", { name: "Registr dokumentů" }).first()).toBeVisible();
    await expect(page.getByText("Smernice pro spravu rizene dokumentace")).toBeVisible();

    await page.getByPlaceholder("Název, ID, gestor, vlastník nebo štítek").fill("bezpecnostnich");
    await expect(page.getByText("Zobrazeno 1 z 9")).toBeVisible();
    await expect(page.getByText("Metodika vyjimek z bezpecnostnich pravidel")).toBeVisible();

    await page.locator("#document-registry-classification").click();
    await page.getByRole("option", { name: /restricted/ }).click();
    await page.getByRole("button", { name: "Zavřít filtr" }).click();
    await expect(page.getByText("Zobrazeno 1 z 9")).toBeVisible();

    await page.getByRole("button", { name: "Vyčistit" }).click();
    await expect(page.getByText("Zobrazeno 9 z 9")).toBeVisible();
    await expect(page.locator("#document-registry-classification")).toHaveText("Vše");
  });

  test("DW-06, DW-07, DW-09, DW-12, DW-13 and DW-19 detail shows viewer, workflow, governance, assignments, audit and locked publish gate", async ({ page }) => {
    await page.goto(appPath("/documents/doc_102"));

    await expect(page.getByRole("heading", { name: "Detail dokumentu" })).toBeVisible();
    await expect(page.getByText("Metodika vyjimek z bezpecnostnich pravidel").first()).toBeVisible();

    await page.getByRole("button", { name: "Viewer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Source-context" })).toBeVisible();
    await expect(page.getByText("Dostupné source-context signály")).toBeVisible();
    await page.getByRole("button", { name: "Připravit podepsaný zdroj" }).click();
    await expect(page.getByText("Zdrojový objekt není v lokálním storage dostupný.")).toBeVisible();
    await expect(page.getByText("Dostupnost ve storage")).toBeVisible();
    await page.getByRole("button", { name: "Otevřít source-context chunk_789" }).click();
    await expect(page.getByText("Chunk chunk_789")).toBeVisible();
    await expect(page.getByText("Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu.")).toBeVisible();
    await expect(page.getByText("Sekce: Cl. 4 / Odst. 2")).toHaveCount(2);
    await expect(page.getByLabel("Lokace citace").getByText("Sekce: Cl. 4 / Odst. 2")).toBeVisible();
    await expect(page.getByText("Otevření konkrétní strany citace bude dostupné po zpřístupnění podepsaného zdroje.")).toBeVisible();

    await page.getByRole("button", { name: "Workflow", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Publish gate" })).toBeVisible();
    await expect(page.getByText("Publikační akce nejsou pro tuto relaci povolené.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publikovat schválenou verzi" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Organizační odpovědnosti" })).toBeVisible();
    await expect(page.locator('input[value="Security reviewers"]')).toBeVisible();
    await expect(page.locator('input[value="security-reviewers"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workflow tasky" })).toBeVisible();
    await expect(page.getByText("Document review required")).toBeVisible();

    await page.getByRole("button", { name: "Spustit Kontrola compliance" }).click();
    await expect(page.getByRole("heading", { name: "Výsledek governance kontroly" })).toBeVisible();
    await expect(page.getByText("governance_compliance_mock")).toBeVisible();
    await expect(page.getByText("WEB_BRIDGE_METADATA_CONTENT_ONLY")).toBeVisible();

    await page.getByRole("button", { name: "Audit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Auditní stopa dokumentu" })).toBeVisible();
    await expect(page.getByText("document.assignments.updated")).toBeVisible();
    await expect(page.getByText("workflow.task.approve")).toBeVisible();
    await expect(page.getByText("citation.opened")).toBeVisible();
    await expect(page.getByText("source-context", { exact: true })).toBeVisible();
  });

  test("DW-07 native preview opens an available signed image source with OCR bbox", async ({ page }) => {
    await page.goto(appPath("/documents/doc_103"));

    await page.getByRole("button", { name: "Viewer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Nativní preview" })).toBeVisible();
    await expect(page.getByText("Nejprve připravte podepsaný zdroj v panelu Zdroj.")).toBeVisible();

    await page.getByRole("button", { name: "Připravit podepsaný zdroj" }).click();
    await expect(page.getByText("Podepsaný zdroj je připravený.")).toBeVisible();
    await expect(page.getByText("Dostupnost ve storage")).toBeVisible();
    await expect(page.getByText("dostupné", { exact: true })).toBeVisible();
    await expect(page.locator(".native-preview__image")).toBeVisible();

    await page.getByRole("button", { name: "Otevřít source-context chunk_ocr_103" }).click();
    await expect(page.getByText("Spravce musi potvrdit vlastnika, gestora a workflow task.")).toBeVisible();
    await expect(page.getByLabel("OCR oblast citace")).toBeVisible();
    await expect(page.getByLabel("Lokace citace").getByText("Sekce: Prvni kontrola")).toBeVisible();
  });

  test("DW-07 native preview renders Markdown as a structured document", async ({ page }) => {
    await page.goto(appPath("/documents/doc_109"));

    await page.getByRole("button", { name: "Viewer", exact: true }).click();
    await page.getByRole("button", { name: "Připravit podepsaný zdroj" }).click();
    await expect(page.getByText("Podepsaný zdroj je připravený.")).toBeVisible();
    await expect(page.locator(".native-preview__markdown h1")).toHaveText("Markdown preview fixture");
    await expect(page.getByLabel("Obsah dokumentu").getByText("Citation target")).toBeVisible();
    await expect(page.locator(".native-preview__markdown table").getByText("Code blocks")).toBeVisible();
    await expect(page.locator(".native-preview__markdown pre").getByText("viewer_mode: markdown")).toBeVisible();

    await page.getByRole("button", { name: "Otevřít source-context chunk_md_109" }).click();
    await expect(page.locator(".native-preview__markdown-citation")).toContainText("Markdown citation text should be highlighted");
    await expect(page.getByLabel("Lokace citace").getByText("Sekce: Citation target")).toBeVisible();
  });

  test("DW-12A insight proposals are generated from source text", async ({ page }) => {
    await page.goto(appPath("/documents/doc_109"));

    await page.getByRole("button", { name: "Insighty", exact: true }).click();
    await expect(page.getByText("Autoritativní uložení a schvalování v Registry bude další krok.")).toBeVisible();
    await page.getByRole("button", { name: "Navrhnout insighty" }).click();

    await expect(page.getByRole("status")).toContainText("Návrhy insightů byly vytvořené ze zdrojového textu.");
    await expect(page.locator(".insight-item")).toHaveCount(4);
    await expect(page.getByText("Confidence:")).toHaveCount(4);
    await expect(page.getByText("Citace: Extracted source")).toHaveCount(4);
  });

  test("DW-07 native preview renders DOCX, XLSX and presentation sources", async ({ page }) => {
    const cases = [
      {
        documentId: "doc_105",
        expected: ["DOCX source fixture title", "DOCX viewer extracts controlled document paragraphs."]
      },
      {
        documentId: "doc_106",
        expected: ["List: Evidence", "Owner", "Security", "Ready"]
      },
      {
        documentId: "doc_107",
        expected: ["Slide 1", "Presentation source fixture", "Slide text is extracted for native preview."]
      }
    ];

    for (const previewCase of cases) {
      await page.goto(appPath(`/documents/${previewCase.documentId}`));
      await page.getByRole("button", { name: "Viewer", exact: true }).click();
      await page.getByRole("button", { name: "Připravit podepsaný zdroj" }).click();
      await expect(page.getByText("Podepsaný zdroj je připravený.")).toBeVisible();
      for (const expectedText of previewCase.expected) {
        await expect(page.getByText(expectedText).first()).toBeVisible();
      }
    }
  });

  test("DW-07 PDF preview renders citation page with bbox metadata", async ({ page }) => {
    await page.goto(appPath("/documents/doc_108"));

    await page.getByRole("button", { name: "Viewer", exact: true }).click();
    await page.getByRole("button", { name: "Připravit podepsaný zdroj" }).click();
    await expect(page.getByText("Podepsaný zdroj je připravený.")).toBeVisible();
    await page.getByRole("button", { name: "Otevřít source-context chunk_pdf_108" }).click();
    await expect(page.getByText("PDF citation area for controlled document preview.")).toBeVisible();
    await expect(page.locator(".native-preview__pdf-rendered").getByText("Vykreslená strana citace")).toBeVisible();
    await expect(page.locator(".native-preview__pdf-page canvas")).toBeVisible();
    await expect(page.locator(".native-preview__bbox--pdf-page")).toBeVisible();
    await expect(page.locator(".native-preview__pdf-locator").getByText("Lokace v PDF podle metadat")).toBeVisible();
    await expect(page.getByLabel("Lokace v PDF podle metadat").getByText("Strana 1")).toBeVisible();
  });

  test("DW-08 workflow inbox records an approval decision in mock mode", async ({ page }) => {
    await page.goto(appPath("/tasks"));

    await expect(page.getByRole("heading", { name: "Workflow úkoly" })).toBeVisible();
    await page.getByRole("button", { name: /Document review required/ }).click();
    await expect(page.getByRole("heading", { name: "Detail úkolu" })).toBeVisible();

    await page.getByLabel("Komentář").fill("E2E approval check");
    await page.getByRole("button", { name: "Schválit" }).click();
    await expect(page.getByRole("status")).toContainText("Rozhodnutí bylo zapsané.");
  });

  test("DW-14 knowledge chat opens cited source context", async ({ page }) => {
    await page.goto(appPath("/chat"));

    await expect(page.getByRole("heading", { name: "Znalostní chat" }).first()).toBeVisible();

    // Citations are inside the modal — open it first via the trigger badge
    await page.getByRole("button", { name: /Prohlížeč citací/ }).first().click();
    await expect(page.getByText("Metodika vyjimek z bezpecnostnich pravidel").first()).toBeVisible();

    await page.getByRole("button", { name: "Otevřít citaci" }).first().click();
    await expect(page.getByText("Chunk chunk_789")).toBeVisible();
    await expect(page.getByText("Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Otevřít dokument" }).first()).toHaveAttribute(
      "href",
      appPath("/api/assistant/citations/chunk_789/document")
    );
    await expect(page.getByRole("link", { name: "Otevřít dokument" }).first()).toHaveAttribute("target", "_blank");
  });

  test("DW-15 mobile workspace navigation closes after one tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appPath("/assistant"));

    await page.getByLabel("Otevřít navigaci").click();
    await expect(page.locator(".stratos-app-shell")).toHaveAttribute("data-mobile-sidebar-open", "true");

    await page.getByLabel("Navigace pracovní plochy").getByRole("link", { name: "Znalostní chat" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/chat"));
    await expect(page.locator(".stratos-app-shell")).toHaveAttribute("data-mobile-sidebar-open", "false");
    await expect(page.getByRole("heading", { name: "Znalostní chat" }).first()).toBeVisible();
  });

  test("DW-17 STRATOS rail navigation does not duplicate the configured base path", async ({ page }) => {
    await page.goto(appPath("/tasks"));

    const rail = page.locator(".stratos-app-rail");
    await rail.getByRole("link", { name: "AI" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/chat"));

    await rail.getByRole("link", { name: "Dokumenty" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/documents"));
  });

  test("DW-16 help center renders role-based guidance", async ({ page }) => {
    await page.goto(appPath("/help"));

    await expect(page.getByRole("heading", { name: "Nápověda" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rychlý start" })).toBeVisible();
    await expect(page.getByText("Správce dokumentů")).toBeVisible();
    await expect(page.getByText("Vlastník / gestor")).toBeVisible();
    await expect(page.getByText("Auditor")).toBeVisible();
    await expect(page.getByText("Upload a preflight")).toBeVisible();
    await expect(page.getByText("Workflow publikace")).toBeVisible();
  });
});
