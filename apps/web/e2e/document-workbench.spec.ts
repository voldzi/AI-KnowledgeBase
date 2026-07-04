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

  test("DW-02 new document flow creates first version and guides the operator onward", async ({ page }) => {
    const now = new Date().toISOString();
    const documentId = "doc_e2e_new";
    const versionId = "ver_e2e_new_1";
    const uploadSessionId = "upload_e2e_new";
    const fileHash = "sha256:e2e-new-document";
    let documentPayload: Record<string, unknown> | null = null;

    await page.route(`**${appPath("/api/controlled-document/documents")}`, async (route) => {
      documentPayload = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          document: {
            document_id: documentId,
            title: "E2E založení dokumentu",
            document_type: "methodology",
            status: "draft",
            classification: "internal",
            owner_id: "e2e",
            owner: "E2E operator",
            gestor_unit: "IT",
            tags: ["controlled-document", "akb"],
            created_at: now,
            updated_at: now
          }
        })
      });
    });
    await page.route(`**${appPath("/api/controlled-document/upload/preflight")}`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          preflight: {
            upload_session_id: uploadSessionId,
            upload_url: appPath(`/api/controlled-document/upload/sessions/${uploadSessionId}/content`),
            upload_method: "PUT",
            source_file_uri: "s3://akl-documents/e2e/new-document.pdf",
            expires_at: now,
            required_headers: {
              "X-AKL-Upload-Token": "e2e-token"
            },
            bucket: "akl-documents",
            object_key: "e2e/new-document.pdf",
            file: {
              filename: "new-document.pdf",
              mime_type: "application/pdf",
              size_bytes: 16,
              sha256: fileHash
            },
            limits: {
              max_file_bytes: 52428800,
              accepted_mime_types: ["application/pdf"]
            }
          }
        })
      });
    });
    await page.route(`**${appPath(`/api/controlled-document/upload/sessions/${uploadSessionId}/content`)}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          uploaded: true,
          upload_session_id: uploadSessionId,
          source_file_uri: "s3://akl-documents/e2e/new-document.pdf",
          file: {
            filename: "new-document.pdf",
            mime_type: "application/pdf",
            size_bytes: 16,
            sha256: fileHash
          }
        })
      });
    });
    await page.route(`**${appPath("/api/controlled-document/ingestion")}`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          version: {
            document_version_id: versionId,
            document_id: documentId,
            file_id: "file_e2e_new",
            version_label: "1.0",
            status: "draft",
            valid_from: "2026-06-30",
            valid_to: null,
            source_file_uri: "s3://akl-documents/e2e/new-document.pdf",
            file_hash: fileHash,
            change_summary: "První verze: E2E založení dokumentu.",
            created_at: now,
            published_at: null
          },
          job: {
            job_id: "job_e2e_new",
            document_id: documentId,
            document_version_id: versionId,
            status: "queued",
            parser_profile: "controlled_document",
            ocr_enabled: false,
            chunking_strategy: "legal_structured",
            embedding_profile: "default",
            created_at: now,
            started_at: null,
            finished_at: null
          }
        })
      });
    });

    await page.goto(appPath("/documents/new"));
    await expect(page.getByRole("heading", { name: "Založit dokument a první verzi" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Smlouva" }).click();
    await expect(page.locator("#gestor")).toHaveValue("Právní");
    await expect(page.locator("#tags")).toHaveValue("controlled-document,akb,smlouva");
    await page.locator("#title").fill("E2E založení dokumentu");
    await page.setInputFiles("#source-file", {
      name: "new-document.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nE2E\n")
    });
    await expect(page.locator("form").getByText("Soubor připraven")).toBeVisible();

    await page.getByRole("button", { name: "Založit dokument a spustit zpracování" }).click();

    expect(documentPayload).toMatchObject({
      document_type: "contract",
      classification: "restricted",
      gestor_unit: "Právní",
      tags: "controlled-document,akb,smlouva"
    });
    await expect(page.getByText("Dokument je založený")).toBeVisible();
    await expect(page.getByText("Originální soubor je uložený v AKB a zpracování citací běží na pozadí.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Otevřít dokument" })).toHaveAttribute("href", appPath(`/documents/${documentId}`));
    await expect(page.getByRole("link", { name: "Sledovat zpracování" })).toHaveAttribute("href", appPath("/ingestion"));
    await expect(page.getByRole("link", { name: "Nahrát další verzi" })).toHaveAttribute(
      "href",
      appPath(`/upload?document_id=${documentId}`)
    );

    await page.getByRole("button", { name: "Založit další dokument" }).click();
    await expect(page.locator("#title")).toHaveValue("");
    await expect(page.locator("#gestor")).toHaveValue("IT");
    await expect(page.locator("#tags")).toHaveValue("controlled-document,akb,smernice");
    await expect(page.getByText("Dokument je založený")).toHaveCount(0);
  });

  test("DW-03 document detail starts a version upload with the current document preselected", async ({ page }) => {
    await page.goto(appPath("/documents/doc_102?tab=versions"));

    await expect(page.getByRole("heading", { name: "Historie verzí" })).toBeVisible();
    await expect(page.locator("#versions").getByRole("link", { name: "Nahrát" })).toHaveAttribute(
      "href",
      appPath("/upload?document_id=doc_102")
    );

    await page.goto(appPath("/upload?document_id=doc_102"));
    await expect(page.getByRole("heading", { name: "Nahrání nové verze" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Metodika vyjimek z bezpecnostnich pravidel" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Umístění zdroje" })).toHaveValue(/doc_102/);
  });

  test("DW-06, DW-07, DW-09, DW-12, DW-13 and DW-19 detail shows viewer, workflow, governance, assignments, audit and locked publish gate", async ({ page }) => {
    await page.goto(appPath("/documents/doc_102"));

    await expect(page.getByRole("heading", { name: "Detail dokumentu" })).toBeVisible();
    await expect(page.getByText("Metodika vyjimek z bezpecnostnich pravidel").first()).toBeVisible();

    await page.getByRole("tab", { name: "Dokument", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Citace a kontext" })).toBeVisible();
    await expect(page.getByText("Dostupné citované úseky")).toBeVisible();
    await page.getByRole("button", { name: "Připravit originál" }).click();
    await expect(page.getByText("Originální soubor není v úložišti dostupný.")).toBeVisible();
    await expect(page.getByText("Dostupnost ve storage")).toBeVisible();
    await page.getByRole("button", { name: "Otevřít citaci chunk_789" }).click();
    await expect(page.getByText("Úsek chunk_789")).toBeVisible();
    await expect(page.getByText("Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu.")).toBeVisible();
    await expect(page.getByText("Sekce: Cl. 4 / Odst. 2")).toHaveCount(2);
    await expect(page.getByLabel("Lokace citace").getByText("Sekce: Cl. 4 / Odst. 2")).toBeVisible();
    await expect(page.getByText("Otevření konkrétní strany citace bude dostupné po zpřístupnění podepsaného zdroje.")).toBeVisible();

    await page.getByRole("tab", { name: "Schválení", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Publikace", exact: true })).toBeVisible();
    await expect(page.getByText("Publikační akce nejsou pro tuto relaci povolené.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publikovat schválenou verzi" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Organizační odpovědnosti" })).toBeVisible();
    await expect(page.locator('input[value="Security reviewers"]')).toBeVisible();
    await expect(page.locator('input[value="security-reviewers"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Úkoly k dokumentu" })).toBeVisible();
    await expect(page.getByText("Document review required")).toBeVisible();

    await page.getByRole("button", { name: "Spustit Kontrola compliance" }).click();
    await expect(page.getByRole("heading", { name: "Výsledek governance kontroly" })).toBeVisible();
    await expect(page.getByText("governance_compliance_mock")).toBeVisible();
    await expect(page.getByText("WEB_BRIDGE_METADATA_CONTENT_ONLY")).toBeVisible();

    await page.getByRole("tab", { name: "Audit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Auditní stopa dokumentu" })).toBeVisible();
    await expect(page.getByText("document.assignments.updated")).toBeVisible();
    await expect(page.getByText("workflow.task.approve")).toBeVisible();
    await expect(page.getByText("citation.opened")).toBeVisible();
    await expect(page.getByText(/document_chunk\s*\/\s*chunk_789/)).toBeVisible();
  });

  test("DW-07 native preview opens an available signed image source with OCR bbox", async ({ page }) => {
    await page.goto(appPath("/documents/doc_103"));

    await page.getByRole("tab", { name: "Dokument", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Náhled dokumentu" })).toBeVisible();
    await expect(page.getByText("Nejprve připravte originální dokument v panelu Zdroj.")).toBeVisible();

    await page.getByRole("button", { name: "Připravit originál" }).click();
    await expect(page.getByText("Originální dokument je připravený k otevření.")).toBeVisible();
    await expect(page.getByText("Dostupnost ve storage")).toBeVisible();
    await expect(page.getByText("dostupné", { exact: true })).toBeVisible();
    await expect(page.locator(".native-preview__image")).toBeVisible();

    await page.getByRole("button", { name: "Otevřít citaci chunk_ocr_103" }).click();
    await expect(page.getByText("Spravce musi potvrdit vlastnika, gestora a workflow task.")).toBeVisible();
    await expect(page.getByLabel("OCR oblast citace")).toBeVisible();
    await expect(page.getByLabel("Lokace citace").getByText("Sekce: Prvni kontrola")).toBeVisible();
  });

  test("DW-07 native preview renders Markdown as a structured document", async ({ page }) => {
    await page.goto(appPath("/documents/doc_109"));

    await page.getByRole("tab", { name: "Dokument", exact: true }).click();
    await page.getByRole("button", { name: "Připravit originál" }).click();
    await expect(page.getByText("Originální dokument je připravený k otevření.")).toBeVisible();
    await expect(page.locator(".native-preview__markdown h1")).toHaveText("Markdown preview fixture");
    await expect(page.getByLabel("Obsah dokumentu").getByText("Citation target")).toBeVisible();
    await expect(page.locator(".native-preview__markdown table").getByText("Code blocks")).toBeVisible();
    await expect(page.locator(".native-preview__markdown pre").getByText("viewer_mode: markdown")).toBeVisible();

    await page.getByRole("button", { name: "Otevřít citaci chunk_md_109" }).click();
    await expect(page.locator(".native-preview__markdown-citation")).toContainText("Markdown citation text should be highlighted");
    await expect(page.getByLabel("Lokace citace").getByText("Sekce: Citation target")).toBeVisible();
  });

  test("DW-12A insight proposals are generated from source text", async ({ page }) => {
    await page.goto(appPath("/documents/doc_109"));

    await page.getByRole("tab", { name: "Znalosti", exact: true }).click();
    await expect(page.getByText("Návrhy jsou pracovní podklad pro revizi. Vlastník rozhodne, co se má stát řízenou znalostí.")).toBeVisible();
    await page.getByRole("button", { name: "Navrhnout znalosti" }).click();

    await expect(page.getByRole("status")).toContainText("Návrhy znalostí byly vytvořené ze zdrojového textu.");
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
      await page.getByRole("tab", { name: "Dokument", exact: true }).click();
      await page.getByRole("button", { name: "Připravit originál" }).click();
      await expect(page.getByText("Originální dokument je připravený k otevření.")).toBeVisible();
      for (const expectedText of previewCase.expected) {
        await expect(page.getByText(expectedText).first()).toBeVisible();
      }
    }
  });

  test("DW-07 PDF preview renders citation page with bbox metadata", async ({ page }) => {
    await page.goto(appPath("/documents/doc_108"));

    await page.getByRole("tab", { name: "Dokument", exact: true }).click();
    await page.getByRole("button", { name: "Připravit originál" }).click();
    await expect(page.getByText("Originální dokument je připravený k otevření.")).toBeVisible();
    await page.getByRole("button", { name: "Otevřít citaci chunk_pdf_108" }).click();
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
    await page.getByRole("button", { name: /Kdo schvaluje výjimku/ }).click();
    await expect(page.getByText("Výjimku ze směrnice schvaluje gestor dokumentu po posouzení dopadu.")).toBeVisible();

    const sourcesPanel = page.getByRole("complementary", { name: "Zdroje odpovědi" });
    await expect(sourcesPanel.getByText("Metodika vyjimek z bezpecnostnich pravidel").first()).toBeVisible();
    await sourcesPanel.getByRole("button", { name: "Otevřít citaci" }).first().click();

    const citationDialog = page.getByRole("dialog", { name: "Zdroj odpovědi" });
    await expect(citationDialog.locator(".citation-modal__list-pane")).toHaveCount(0);
    await expect(citationDialog.getByText("Strana 7 · Cl. 4 / Odst. 2")).toBeVisible();
    await expect(citationDialog.getByText("Chunk chunk_789")).toHaveCount(0);
    await expect(citationDialog.locator(".source-viewer__technical")).toHaveCount(0);
    await expect(citationDialog.locator(".source-uri")).toHaveCount(0);
    await expect(citationDialog.getByText("Vyjimku ze smernice schvaluje gestor dokumentu po posouzeni dopadu.")).toBeVisible();
    await expect(citationDialog.getByRole("link", { name: "Otevřít dokument" }).first()).toHaveAttribute(
      "href",
      appPath("/api/assistant/citations/chunk_789/document")
    );
    await expect(citationDialog.getByRole("link", { name: "Otevřít dokument" }).first()).toHaveAttribute("target", "_blank");
  });

  test("DW-14F knowledge chat renders requested obligation tables as structured output", async ({ page }) => {
    await page.goto(appPath("/chat"));

    await page.getByLabel("Zeptejte se na dokument, postup nebo odpovědnost").fill("vytvoř tabulku kde bude seznam povinností");
    await page.getByRole("button", { name: "Odeslat" }).click();

    const assistantMessage = page.locator(".akb-chat-message--assistant").last();
    await expect(assistantMessage.locator(".akb-chat-message__markdown")).toContainText("V citovaných zdrojích se objevují tyto oblasti povinností:");
    await expect(assistantMessage.locator(".akb-chat-message__markdown table")).toHaveCount(0);
    await expect(assistantMessage.locator(".akb-chat-message__markdown")).not.toContainText("| :--- |");

    const report = assistantMessage.locator(".akb-chat-report");
    await expect(report.getByRole("heading", { name: "Seznam povinností" })).toBeVisible();
    await expect(report).toContainText("4 řádků");
    await expect(report).toContainText("Právní povinnosti");
    await expect(report).toContainText("Jiné závazky");
    await expect(report).not.toContainText("vytvoř tabulku kde bude seznam povinností");
  });

  test("DW-14G knowledge chat report mode guides natural questions into exportable reports", async ({ page }) => {
    await page.goto(appPath("/chat"));

    const reportMode = page.locator(".akb-chat-report-mode");
    await reportMode.locator(".akb-chat-report-mode__toggle").click();
    await expect(reportMode.locator(".akb-chat-report-mode__panel")).toBeVisible();
    await reportMode.getByText("Vlastník nebo role").click();
    await page.getByLabel("Zeptejte se na dokument, postup nebo odpovědnost").fill("Jaké povinnosti z toho plynou?");
    await page.getByRole("button", { name: "Odeslat" }).click();

    const assistantMessage = page.locator(".akb-chat-message--assistant").last();
    const report = assistantMessage.locator(".akb-chat-report");
    await expect(report.getByRole("heading", { name: "Seznam povinností" })).toBeVisible();
    await expect(report).toContainText("Vlastník nebo role");
    await expect(report).toContainText("Gestor dokumentu");
    await expect(report.getByRole("button", { name: /Exportovat Excel/ })).toBeVisible();
    await expect(report.getByRole("button", { name: /Exportovat PDF/ })).toHaveCount(0);
  });

  test("DW-14A assistant citation document endpoint redirects to signed source content", async ({ page }) => {
    await page.goto(appPath("/api/assistant/citations/chunk_md_109/document"));

    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/api/documents/source/content"));
    await expect(page.getByText("Markdown preview fixture")).toBeVisible();
    await expect(page.getByText("Citation target")).toBeVisible();
  });

  test("DW-14B assistant citation redirect does not leak internal Docker host", async ({ request }) => {
    const response = await request.get(appPath("/api/assistant/citations/chunk_md_109/document"), {
      headers: { Host: "ff6f9ebba65c:3000" },
      maxRedirects: 0
    });
    const location = response.headers().location ?? "";

    expect(response.status()).toBe(307);
    expect(location).toContain(appPath("/api/documents/source/content"));
    expect(location).not.toContain("ff6f9ebba65c");
  });

  test("DW-14C assistant PDF document redirect opens the source page with citation search", async ({ request }) => {
    const response = await request.get(appPath("/api/assistant/citations/chunk_pdf_108/document"), {
      maxRedirects: 0
    });
    const location = response.headers().location ?? "";

    expect(response.status()).toBe(307);
    expect(location).toContain(appPath("/api/documents/source/content"));
    expect(location).toContain("#page=1");
    expect(decodeURIComponent(location)).toContain("search=PDF citation area for controlled document preview.");
  });

  test("DW-14D legacy assistant route redirects to the single chat portal", async ({ page }) => {
    await page.goto(appPath("/assistant"));

    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/chat"));
    await expect(page.getByRole("heading", { name: "Znalostní chat" }).first()).toBeVisible();
  });

  test("DW-14E STRATOS source-open bridge returns a signed PDF download", async ({ request }) => {
    const sourceOpenResponse = await request.post(
      appPath("/api/stratos/documents/doc_108/source-open?version_id=ver_108_1")
    );

    expect(sourceOpenResponse.status()).toBe(201);
    expect(sourceOpenResponse.headers()["content-type"]).toContain("application/json");
    const sourceOpenBody = (await sourceOpenResponse.json()) as {
      source_open: {
        available: boolean;
        download_url: string | null;
        file: {
          filename: string;
          mime_type: string;
        };
      };
    };
    expect(sourceOpenBody.source_open.available).toBe(true);
    expect(sourceOpenBody.source_open.file.mime_type).toBe("application/pdf");
    expect(sourceOpenBody.source_open.download_url).toContain(appPath("/api/documents/source/content?token="));

    const sourceResponse = await request.get(sourceOpenBody.source_open.download_url ?? "");
    expect(sourceResponse.status()).toBe(200);
    expect(sourceResponse.headers()["content-type"]).toContain("application/pdf");
    const bytes = await sourceResponse.body();
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  test("DW-15 mobile workspace navigation closes after one tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appPath("/help"));
    await expect(page.getByRole("heading", { name: "Nápověda" })).toBeVisible();

    await page.getByLabel("Otevřít navigaci").click();
    await expect(page.locator(".stratos-app-shell")).toHaveClass(/is-mobile-sidebar-open/);

    await page.getByLabel("Navigace pracovní plochy").getByRole("link", { name: "Znalostní chat" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/chat"));
    await expect(page.locator(".stratos-app-shell")).not.toHaveClass(/is-mobile-sidebar-open/);
    await expect(page.getByRole("heading", { name: "Znalostní chat" }).first()).toBeVisible();
  });

  test("DW-15A mobile module switcher activates a module with one tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appPath("/tasks"));

    await page.getByLabel("Otevřít navigaci").click();
    await expect(page.locator(".stratos-app-shell")).toHaveClass(/is-mobile-sidebar-open/);

    await page.locator(".sidebar-mobile-sections").getByRole("link", { name: "Dokumenty" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/documents"));
    await expect(page.locator(".stratos-app-shell")).not.toHaveClass(/is-mobile-sidebar-open/);
    await expect(page.getByRole("heading", { name: "Registr dokumentů" }).first()).toBeVisible();
  });

  test("DW-17 STRATOS rail navigation does not duplicate the configured base path", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(appPath("/tasks"));

    const rail = page.locator(".stratos-app-rail");
    await rail.getByRole("button", { name: "AI" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/chat"));

    await rail.getByRole("button", { name: "Dokumenty" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(appPath("/documents"));
  });

  test("DW-16 help center renders role-based guidance", async ({ page }) => {
    await page.goto(appPath("/help"));

    await expect(page.getByRole("heading", { name: "Nápověda" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rychlý start" })).toBeVisible();
    await expect(page.getByText("Správce dokumentů")).toBeVisible();
    await expect(page.getByText("Vlastník / gestor")).toBeVisible();
    await expect(page.getByText("Auditor")).toBeVisible();
    await expect(page.getByText("Nahrání verze")).toBeVisible();
    await expect(page.getByText("Schválení a publikace")).toBeVisible();
  });
});
