import { DashboardPage } from "@/features/dashboard/dashboard-page";

export { dynamic } from "@/features/dashboard/dashboard-page";

export default async function HomePage() {
  return DashboardPage({ returnTo: "/" });
}
