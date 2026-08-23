import { Suspense } from "react";

import { DashboardLoading } from "@/features/dashboard/dashboard-loading";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export { dynamic } from "@/features/dashboard/dashboard-page";

export default function DashboardRoutePage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardPage returnTo="/dashboard" />
    </Suspense>
  );
}
