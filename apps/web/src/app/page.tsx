import ChatPage from "@/app/chat/page";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { getAklConfig } from "@/lib/api/config";

export { dynamic } from "@/features/dashboard/dashboard-page";

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  if (getAklConfig().webProfile === "chat") {
    return <ChatPage searchParams={searchParams} />;
  }
  return DashboardPage({ returnTo: "/" });
}
