import { expect, test } from "@playwright/test";

const base = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";
const appPath = (path: string) => `${base}${path}`;

for (const flow of ["new", "version"] as const) {
  test(`native ${flow} form retries only the identical confirmation after a lost reply`, async ({ page }) => {
    const documentId = flow === "new" ? "doc_browser_native_recovery" : "doc_101";
    const sourceUri = `s3://akl-documents/${documentId}/native-recovery.pdf`;
    const uploadPath = appPath("/api/document-intake/v1/sessions/browser-recovery/content");
    const confirmationBodies: string[] = [];
    let preparation: Record<string, unknown>;
    let preflightCount = 0;
    let uploadCount = 0;
    let createCount = 0;
    await page.route(`**${appPath("/api/controlled-document/documents")}`, async (route) => {
      createCount += 1;
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { document: { ...body, document_id:documentId,
        current_root_metadata_revision:"browser-root-revision", status:"draft", created_at:new Date().toISOString(),updated_at:new Date().toISOString() } }, status:201 });
    });
    await page.route(`**${appPath("/api/controlled-document/upload/preflight")}`, async (route) => {
      preflightCount += 1;
      preparation = route.request().postDataJSON();
      await route.fulfill({json:{preflight:{upload_session_id:"browser-recovery",upload_url:uploadPath,upload_method:"PUT",
        source_file_uri:sourceUri,object_key:"native-recovery.pdf",expires_at:"2099-01-01T00:00:00Z",
        required_headers:{"X-AKL-Upload-Token":"browser-recovery-exact-token","Content-Type":"application/pdf"}}},status:201});
    });
    await page.route(`**${uploadPath}`, async (route) => {
      expect(route.request().method()).toBe("PUT");uploadCount += 1;
      await route.fulfill({json:{source_file_uri:sourceUri,upload_receipt:"browser-recovery-exact-receipt",
        file:{filename:preparation.file_name,mime_type:preparation.file_type,size_bytes:preparation.file_size,sha256:preparation.sha256}},status:201});
    });
    await page.route(`**${appPath("/api/controlled-document/ingestion")}`, async (route) => {
      confirmationBodies.push(route.request().postData()!);
      if (confirmationBodies.length === 1) {
        // Model an upstream commit whose reply never reaches this browser.
        await route.abort("connectionfailed");return;
      }
      await route.fulfill({status:200,json:{version:{document_version_id:"ver_browser_recovered",document_id:documentId,idempotent_replay:true},
        job:{job_id:"ing_browser_recovered",status:"queued",document_id:documentId,document_version_id:"ver_browser_recovered"}}});
    });
    await page.goto(appPath(flow === "new" ? "/documents/new" : "/upload?document_id=doc_101"));
    if (flow === "new") {
      await page.getByRole("button",{name:"Smlouva",exact:true}).click();
      await page.locator("#title").fill("Obnova potvrzení dokumentu");
      await page.locator("#profile-owner").click();
      await page.getByRole("option",{name:"Jan Novák",exact:true}).click();
      await page.locator("#profile-author-0").click();
      await page.getByRole("option",{name:"Eva Horáková",exact:true}).click();
      await page.locator("#profile-author-evidence-0").fill("record:authorship:recovery");
      await page.locator("#profile-domain-contractReference").fill("contract:recovery");
      await page.locator("#profile-domain-partyReferences").fill("organization:one\norganization:two");
      await page.locator("#profile-domain-executionStatus").click();
      await page.getByRole("option",{name:"Podepsaná",exact:true}).click();
      await page.locator("#profile-domain-executionEvidenceReference").fill("signature:recovery");
      await page.locator("#document-tlp").click();
      await page.getByRole("option",{name:"TLP:CLEAR",exact:true}).click();
    } else {
      await page.locator("#profile-domain-issuerReference").fill("issuer:recovery");
      await page.locator("#profile-domain-applicability").fill("Organizace");
      await page.locator("#profile-domain-effectiveDateEvidenceReference").fill("effectivity:recovery");
    }
    await page.locator("#profile-effectiveFrom").fill("2026-09-01");
    await page.locator("#profile-reviewAt").fill("2027-09-01");
    await page.setInputFiles('input[type="file"]',{name:"native-recovery.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\nBrowser recovery\n")});
    const initialLabel = flow === "new" ? "Založit dokument a spustit zpracování" : "Nahrát verzi a spustit zpracování";
    await page.getByRole("button",{name:initialLabel,exact:true}).click();
    await expect(page.locator("form").getByRole("alert")).toBeVisible();
    await expect(page.locator("#profile-effectiveFrom")).toBeDisabled();
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    if (flow === "new") await expect(page.locator("#profile-owner")).toBeDisabled();
    await expect(page.getByRole("button",{name:"Zkusit potvrzení znovu",exact:true})).toBeFocused();
    await page.getByRole("button",{name:"Zkusit potvrzení znovu",exact:true}).click();
    if (flow === "new") await expect(page.getByText("Dokument je založený",{exact:true})).toBeVisible();
    else await expect(page.getByText(/ver_browser_recovered/)).toBeVisible();
    expect(confirmationBodies).toHaveLength(2);
    expect(confirmationBodies[1]).toBe(confirmationBodies[0]);
    expect(JSON.parse(confirmationBodies[1])).toMatchObject({upload_token:"browser-recovery-exact-token",upload_receipt:"browser-recovery-exact-receipt",source_file_uri:sourceUri});
    expect(preflightCount).toBe(1);expect(uploadCount).toBe(1);expect(createCount).toBe(flow === "new" ? 1 : 0);
  });
}
