import { NextResponse } from "next/server";

import {
  normalizePublicSlug,
  openPublicSource,
  parsePublicByteRange,
  publicContentDisposition,
  publicEtagMatches,
  publicSourceEtag,
  PublicDocumentDeliveryError,
  resolveInternalPublicDocumentSource
} from "@/lib/public-documents";
import {
  acquirePublicDeliveryLease,
  PublicDeliveryLimitError,
  publicRateLimitResponse,
  streamWithPublicDeliveryLease,
  type PublicDeliveryLease
} from "@/lib/public-delivery-limiter";
import { SourceDownloadError } from "@/lib/upload/source-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ publicSlug: string }> }
) {
  let lease: PublicDeliveryLease | undefined;
  let leaseTransferred = false;
  let openedSource: Awaited<ReturnType<typeof openPublicSource>> | undefined;
  let knownSize: number | undefined;
  try {
    const { publicSlug } = await context.params;
    const normalizedSlug = normalizePublicSlug(publicSlug);
    lease = acquirePublicDeliveryLease(request, normalizedSlug);
    const resolution = await resolveInternalPublicDocumentSource(normalizedSlug);
    knownSize = resolution.size_bytes;
    const expectedEtag = publicSourceEtag(resolution.sha256);
    const notModified = publicEtagMatches(request.headers.get("if-none-match"), expectedEtag);
    const rangeHeader =
      request.headers.get("if-range") && request.headers.get("if-range") !== expectedEtag
        ? null
        : request.headers.get("range");
    const range = notModified
      ? null
      : parsePublicByteRange(rangeHeader, resolution.size_bytes);
    openedSource = await openPublicSource(resolution);
    const etag = publicSourceEtag(openedSource.sha256);
    if (notModified) {
      return new Response(null, {
        status: 304,
        headers: publicSourceHeaders({
          resolution,
          etag,
          contentLength: openedSource.sizeBytes
        })
      });
    }
    const sourceStream = openedSource.openStream(range?.start, range?.end);
    const body = streamWithPublicDeliveryLease(sourceStream, lease);
    const response = new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...publicSourceHeaders({
          resolution,
          etag,
          contentLength: range?.length ?? openedSource.sizeBytes,
          filename: openedSource.filename,
          mimeType: openedSource.mimeType
        }),
        ...(range
          ? { "Content-Range": `bytes ${range.start}-${range.end}/${openedSource.sizeBytes}` }
          : {})
      }
    });
    leaseTransferred = true;
    return response;
  } catch (error) {
    if (error instanceof PublicDeliveryLimitError) return publicRateLimitResponse(error);
    const known =
      error instanceof PublicDocumentDeliveryError
        ? error
        : error instanceof SourceDownloadError
          ? new PublicDocumentDeliveryError(
              error.status === 404 ? 404 : 503,
              error.status === 404 ? "PUBLIC_DOCUMENT_UNAVAILABLE" : "PUBLIC_DELIVERY_UNAVAILABLE",
              error.status === 404 ? "The public document is unavailable." : "Public source delivery is unavailable."
            )
          : null;
    return NextResponse.json(
      {
        error: {
          code: known?.code ?? "PUBLIC_DELIVERY_ERROR",
          message: known?.message ?? "Public source delivery failed closed."
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
          ...(known?.status === 416 && knownSize !== undefined
            ? { "Content-Range": `bytes */${knownSize}` }
            : {}),
          "X-Content-Type-Options": "nosniff"
        }
      }
    );
  } finally {
    if (!leaseTransferred) {
      await openedSource?.close().catch(() => undefined);
      lease?.release();
    }
  }
}

function publicSourceHeaders({
  resolution,
  etag,
  contentLength,
  filename = resolution.filename,
  mimeType = resolution.mime_type
}: {
  resolution: Awaited<ReturnType<typeof resolveInternalPublicDocumentSource>>;
  etag: string;
  contentLength: number;
  filename?: string;
  mimeType?: string;
}): Record<string, string> {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": publicContentDisposition(filename),
    "Content-Length": String(contentLength),
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Content-Type": mimeType,
    ETag: etag,
    "X-AKB-Public-Decision-Id": resolution.decision_id,
    "X-Content-Type-Options": "nosniff"
  };
}
