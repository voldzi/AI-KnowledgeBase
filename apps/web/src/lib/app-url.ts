export function withAppBasePath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH?.replace(/\/+$/, "") ?? "";
  if (!basePath || path.startsWith("#") || path.startsWith("?") || path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    return path;
  }
  if (path === basePath || path.startsWith(`${basePath}/`) || path.startsWith(`${basePath}?`) || path.startsWith(`${basePath}#`)) {
    return path;
  }
  return `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
}
