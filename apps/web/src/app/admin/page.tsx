import { PageHeader } from "@/components/page-header";
import { AdminSkeleton } from "@/features/admin/admin-skeleton";
import { getServerApiClients, getServerRequestContextForPath } from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/admin");
  requirePageAccess(context, "admin");
  const [authorization, roleMappings] = await Promise.all([
    clients.registry.getAuthorizationHints(context),
    clients.registry.listRoleMappings(context, true),
  ]);

  return (
    <>
      <PageHeader
        title={{ cs: "Administrace", en: "Administration" }}
        description={{
          cs: "Správa identit z adresáře a Registry mapování aplikačních rolí AKB.",
          en: "Manage directory identities and Registry-backed AKB role mappings."
        }}
      />
      <AdminSkeleton authorization={authorization} initialRoleMappings={roleMappings} />
    </>
  );
}
