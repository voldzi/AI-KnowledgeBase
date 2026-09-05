export function equalCanonicalJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
  } catch {
    return false;
  }
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Value is not JSON-safe.");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalJsonValue(record[key])]),
    );
  }
  throw new TypeError("Value contains a non-JSON value.");
}
