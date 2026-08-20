const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RequestMetadata = {
  method: string;
  pathname: string;
  origin: string | null;
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
  if (!configuredPublicBaseUrl || !request.origin) return false;

  try {
    return new URL(request.origin).origin === new URL(configuredPublicBaseUrl).origin;
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
