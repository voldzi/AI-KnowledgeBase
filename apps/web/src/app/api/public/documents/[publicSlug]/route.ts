import { NextResponse } from "next/server";

import {
  fetchPublicDocumentMetadata,
  normalizePublicSlug,
  PublicDocumentDeliveryError
} from "@/lib/public-documents";
import {
  acquirePublicDeliveryLease,
  PublicDeliveryLimitError,
  publicRateLimitResponse,
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
    return NextResponse.json(metadata, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof PublicDeliveryLimitError) return publicRateLimitResponse(error);
    return publicDocumentError(error);
  } finally {
    lease?.release();
  }
}

function publicDocumentError(error: unknown): NextResponse {
  const known = error instanceof PublicDocumentDeliveryError ? error : null;
  return NextResponse.json(
    {
      error: {
        code: known?.code ?? "PUBLIC_DELIVERY_ERROR",
        message: known?.message ?? "Public document delivery failed closed."
      }
    },
    {
      status: known?.status ?? 500,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        ...(known?.status === 429
          ? { "Retry-After": String(known.retryAfterSeconds ?? 60) }
          : {}),
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}
