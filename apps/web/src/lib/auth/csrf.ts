const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RequestMetadata = {
  method: string;
  pathname: string;
  origin: string | null;
  referer: string | null;
  secFetchSite: string | null;
  hasServerSession: boolean;
};

export function requiresSessionOriginCheck(request: RequestMetadata): boolean {
  return (
    request.hasServerSession
    && UNSAFE_METHODS.has(request.method.toUpperCase())
    && isApiPath(request.pathname)
  );
}

export function hasAllowedSessionRequestOrigin(
  request: RequestMetadata,
  configuredPublicBaseUrl: string | undefined,
): boolean {
  if (!requiresSessionOriginCheck(request)) return true;
  if (!configuredPublicBaseUrl) return false;

  try {
    const configuredOrigin = new URL(configuredPublicBaseUrl).origin;
    if (request.origin) {
      return new URL(request.origin).origin === configuredOrigin;
    }

    return request.secFetchSite === "same-origin"
      && Boolean(request.referer)
      && new URL(request.referer as string).origin === configuredOrigin;
  } catch {
    return false;
  }
}

function isApiPath(pathname: string): boolean {
  const normalized = pathname.split(/[?#]/, 1)[0] || "/";
  return normalized === "/api"
    || normalized.startsWith("/api/")
    || normalized.includes("/api/");
}
