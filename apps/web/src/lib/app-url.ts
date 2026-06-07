const rawBasePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";

export function withAppBasePath(path: string): string {
  if (!rawBasePath || /^https?:\/\//.test(path)) {
    return path;
  }
  return `${rawBasePath}${path.startsWith("/") ? path : `/${path}`}`;
}
