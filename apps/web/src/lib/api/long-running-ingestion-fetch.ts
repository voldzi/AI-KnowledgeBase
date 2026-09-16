import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import type { AklFetch } from "./http-client";

export const LONG_RUNNING_INGESTION_TIMEOUT_MS = 1_020_000;

/**
 * Uses Node's HTTP client for the synchronous ingestion submission path.
 *
 * Node's built-in fetch applies a five-minute header timeout. Docling is
 * deliberately allowed up to fifteen minutes for a single controlled document,
 * so the generic fetch would report a false upstream failure while the ingest
 * service was still completing the idempotent job.
 */
export const longRunningIngestionFetch: AklFetch = async (input, init = {}) => {
  const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Unsupported ingestion protocol: ${url.protocol}`);
  }

  if (init.body !== undefined && typeof init.body !== "string") {
    throw new TypeError("Long-running ingestion requests require a string body");
  }

  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
    }, (response) => {
      const chunks: Uint8Array[] = [];
      response.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined) continue;
          responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 500,
          statusText: response.statusMessage ?? "",
          headers: responseHeaders,
        }));
      });
    });

    const abort = () => request.destroy(init.signal?.reason instanceof Error ? init.signal.reason : new Error("Request aborted"));
    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.setTimeout(LONG_RUNNING_INGESTION_TIMEOUT_MS, () => {
      request.destroy(new Error("Long-running ingestion request timed out"));
    });
    request.end(init.body);
  });
};
