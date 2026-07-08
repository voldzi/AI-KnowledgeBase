export const AKB_BROWSER_SESSION_COOKIE = "akl_session";

type AppBasePathEnv = {
  NEXT_PUBLIC_AKL_BASE_PATH?: string;
};

function defaultEnv(): AppBasePathEnv {
  return { NEXT_PUBLIC_AKL_BASE_PATH: process.env.NEXT_PUBLIC_AKL_BASE_PATH };
}

export function normalizedAppBasePath(env: AppBasePathEnv = defaultEnv()): string {
  const configured = env.NEXT_PUBLIC_AKL_BASE_PATH?.trim().replace(/\/+$/, "") ?? "";
  return configured === "/" ? "" : configured;
}

export function isAppRootPath(pathname: string, env: AppBasePathEnv = defaultEnv()): boolean {
  const basePath = normalizedAppBasePath(env);
  if (!basePath) {
    return pathname === "/" || pathname === "";
  }
  return pathname === basePath || pathname === `${basePath}/` || pathname === "/";
}

export function buildRootLoginPath(env: AppBasePathEnv = defaultEnv()): string {
  const basePath = normalizedAppBasePath(env);
  return `${basePath}/api/auth/login`;
}
