const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

export class PdfStreamValidationError extends Error {
  constructor(
    readonly status: number,
    readonly code: "DOCUMENT_RENDITION_OUTPUT_TOO_LARGE" | "DOCUMENT_RENDITION_CONTRACT_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "PdfStreamValidationError";
  }
}

export async function openValidatedPdfStream(
  response: Response,
  maxBytes: number,
): Promise<{ body: ReadableStream<Uint8Array>; contentLength: number | null }> {
  const contentLength = declaredContentLength(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    throw tooLarge();
  }
  if (contentLength !== null && contentLength < PDF_MAGIC.length) {
    throw contractMismatch();
  }
  if (!response.body) throw contractMismatch();

  const reader = response.body.getReader();
  const buffered: Uint8Array[] = [];
  const prefix = new Uint8Array(PDF_MAGIC.length);
  let prefixLength = 0;
  let totalBytes = 0;

  try {
    while (prefixLength < PDF_MAGIC.length) {
      const { done, value } = await reader.read();
      if (done) throw contractMismatch();
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) throw tooLarge();
      buffered.push(value);
      const copyLength = Math.min(value.byteLength, PDF_MAGIC.length - prefixLength);
      prefix.set(value.subarray(0, copyLength), prefixLength);
      prefixLength += copyLength;
    }
    if (PDF_MAGIC.some((value, index) => prefix[index] !== value)) {
      throw contractMismatch();
    }
  } catch (error) {
    await reader.cancel("invalid PDF rendition").catch(() => undefined);
    reader.releaseLock();
    throw error;
  }

  let bufferedIndex = 0;
  let closed = false;
  const closeReader = () => {
    if (closed) return;
    closed = true;
    reader.releaseLock();
  };

  return {
    contentLength,
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (bufferedIndex < buffered.length) {
          controller.enqueue(buffered[bufferedIndex++]!);
          return;
        }
        try {
          const { done, value } = await reader.read();
          if (done) {
            closeReader();
            controller.close();
            return;
          }
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel("PDF rendition exceeds its size limit").catch(() => undefined);
            closeReader();
            controller.error(tooLarge());
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          closeReader();
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
        closeReader();
      },
    }),
  };
}

function declaredContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function tooLarge(): PdfStreamValidationError {
  return new PdfStreamValidationError(
    413,
    "DOCUMENT_RENDITION_OUTPUT_TOO_LARGE",
    "The rendered preview exceeds its size limit.",
  );
}

function contractMismatch(): PdfStreamValidationError {
  return new PdfStreamValidationError(
    502,
    "DOCUMENT_RENDITION_CONTRACT_MISMATCH",
    "The rendition service returned an invalid PDF preview.",
  );
}
