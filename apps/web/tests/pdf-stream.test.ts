import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  openValidatedPdfStream,
  PdfStreamValidationError,
} from "../src/lib/upload/pdf-stream";

describe("PDF rendition streaming", () => {
  it("validates the PDF prefix across chunks without buffering the full response", async () => {
    const body = chunkedStream([
      new Uint8Array([0x25, 0x50]),
      new Uint8Array([0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
      new TextEncoder().encode("\nbody"),
    ]);
    const rendition = await openValidatedPdfStream(
      new Response(body, { headers: { "Content-Length": "13" } }),
      1024,
    );

    assert.equal(rendition.contentLength, 13);
    assert.equal(
      new TextDecoder().decode(await readAll(rendition.body)),
      "%PDF-1.7\nbody",
    );
  });

  it("rejects a non-PDF response before returning a stream", async () => {
    await assert.rejects(
      () => openValidatedPdfStream(new Response("not a PDF"), 1024),
      (error: unknown) => (
        error instanceof PdfStreamValidationError
        && error.code === "DOCUMENT_RENDITION_CONTRACT_MISMATCH"
      ),
    );
  });

  it("rejects a declared response larger than the configured limit", async () => {
    await assert.rejects(
      () => openValidatedPdfStream(
        new Response("%PDF-1.7", { headers: { "Content-Length": "2048" } }),
        1024,
      ),
      (error: unknown) => (
        error instanceof PdfStreamValidationError
        && error.code === "DOCUMENT_RENDITION_OUTPUT_TOO_LARGE"
      ),
    );
  });

  it("stops an undeclared stream when its actual size exceeds the limit", async () => {
    const rendition = await openValidatedPdfStream(
      new Response(chunkedStream([
        new TextEncoder().encode("%PDF-"),
        new TextEncoder().encode("payload"),
      ])),
      8,
    );

    await assert.rejects(
      () => readAll(rendition.body),
      (error: unknown) => (
        error instanceof PdfStreamValidationError
        && error.code === "DOCUMENT_RENDITION_OUTPUT_TOO_LARGE"
      ),
    );
  });
});

function chunkedStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]!);
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
