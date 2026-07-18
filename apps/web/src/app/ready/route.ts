import { GET as apiReady } from "../api/ready/route";

export const runtime = "nodejs";

export async function GET() {
  return apiReady();
}
