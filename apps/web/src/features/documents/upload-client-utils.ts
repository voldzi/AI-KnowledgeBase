"use client";

import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/documents/document-formats";

export const SUPPORTED_UPLOAD_ACCEPT = DOCUMENT_UPLOAD_ACCEPT;

export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

export async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return `sha256:${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? "";
  } catch {
    return "";
  }
}
