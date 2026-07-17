import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { getAklConfig } from "@/lib/api/config";
import { redirect } from "next/navigation";

export { dynamic } from "@/features/dashboard/dashboard-page";

export default async function HomePage() {
  if (getAklConfig().webProfile === "chat") {
    redirect("/chat");
  }
  return DashboardPage({ returnTo: "/" });
}
