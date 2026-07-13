import {
  buildPublicDocumentPageModel,
  publicDocumentPageHeaders,
  renderPublicDocumentPage,
  renderPublicDocumentUnavailablePage
} from "@/lib/public-document-page";
import {
  fetchPublicDocumentMetadata,
  normalizePublicSlug,
  PublicDocumentDeliveryError
} from "@/lib/public-documents";
import {
  acquirePublicDeliveryLease,
  PublicDeliveryLimitError,
  type PublicDeliveryLease
} from "@/lib/public-delivery-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ publicSlug: string }> }
) {
  let lease: PublicDeliveryLease | undefined;
  try {
    const { publicSlug } = await context.params;
    const normalizedSlug = normalizePublicSlug(publicSlug);
    lease = acquirePublicDeliveryLease(request, normalizedSlug);
    const metadata = await fetchPublicDocumentMetadata(normalizedSlug);
    const page = buildPublicDocumentPageModel(metadata, normalizedSlug);
    return new Response(renderPublicDocumentPage(page), {
      status: 200,
      headers: publicDocumentPageHeaders()
    });
  } catch (error) {
    const rateLimited =
      error instanceof PublicDeliveryLimitError ||
      (error instanceof PublicDocumentDeliveryError && error.status === 429);
    const retryAfter =
      error instanceof PublicDeliveryLimitError
        ? error.retryAfterSeconds
        : error instanceof PublicDocumentDeliveryError
          ? error.retryAfterSeconds ?? 60
          : undefined;
    return new Response(renderPublicDocumentUnavailablePage(), {
      status: rateLimited ? 429 : 404,
      headers: {
        ...publicDocumentPageHeaders(),
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {})
      }
    });
  } finally {
    lease?.release();
  }
}
