import { PageHeader } from "@/components/page-header";
import { AdminSkeleton } from "@/features/admin/admin-skeleton";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/admin");
  requirePageAccess(context, "admin");
  const authorization = await clients.registry.getAuthorizationHints(context);

  return (
    <>
      <PageHeader
        title={{ cs: "Administrace", en: "Administration" }}
        description={{
          cs: "Základní správa mapování rolí, připravenosti OIDC, policy hintů a dostupnosti služeb.",
          en: "Early administration surface for role mapping, OIDC readiness, policy hints and service connectivity."
        }}
      />
      <AdminSkeleton authorization={authorization} />
    </>
  );
}
