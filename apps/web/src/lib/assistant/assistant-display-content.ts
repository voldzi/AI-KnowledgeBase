export function sanitizeAssistantDisplayContent(value: string): string {
  let text = value.replace(/\s*\[(?:\s*chunk_[A-Za-z0-9]+\s*,?)+\]/g, "");
  text = text.replace(/\s*\[chunk_[^\]]+\]/g, "");
  text = text.replace(/\s*\[\s*chunk_[A-Za-z0-9_,\s]*$/g, "");
  return text.replace(
    /(^|[^A-Za-z0-9_])chunk_[A-Za-z0-9]*(?![A-Za-z0-9_])/g,
    "$1",
  ).trim();
}
