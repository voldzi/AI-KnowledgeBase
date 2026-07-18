import { GET as apiHealth } from "../api/health/route";

export const runtime = "nodejs";

export function GET() {
  return apiHealth();
}
