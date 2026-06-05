export function formatDateTime(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Prague"
  }).format(new Date(value));
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "bez konce";
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeZone: "Europe/Prague"
  }).format(new Date(value));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("cs-CZ").format(value);
}

export function documentTypeLabel(value: string): string {
  return value.replaceAll("_", " ");
}
