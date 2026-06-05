import { KeyRound, ServerCog, ShieldCheck, UserCog } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import type { AuthorizationHint } from "@/lib/types";

interface AdminSkeletonProps {
  authorization: AuthorizationHint;
}

export function AdminSkeleton({ authorization }: AdminSkeletonProps) {
  return (
    <div className="stack">
      <section className="grid grid--three">
        <MetricCard icon={ServerCog} label="Registry API" value="online" detail="Health endpoint reachable in mock mode" tone="success" />
        <MetricCard icon={ServerCog} label="Ingestion Service" value="online" detail="Job client configured" tone="success" />
        <MetricCard icon={ServerCog} label="RAG Retrieval" value="online" detail="Citation query client configured" tone="success" />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Administration skeleton</h2>
          <StatusBadge value={authorization.can_manage_admin ? "valid" : "draft"} label={authorization.can_manage_admin ? "admin.manage" : "read only"} />
        </div>
        <div className="panel__body grid grid--three">
          <div className="timeline-item">
            <UserCog size={18} aria-hidden="true" />
            <strong>Role mappings</strong>
            <span>Planned surface for admin, document_manager, reviewer, reader and auditor roles.</span>
          </div>
          <div className="timeline-item">
            <KeyRound size={18} aria-hidden="true" />
            <strong>OIDC setup</strong>
            <span>Production must use OIDC/JWT. Mock auth is blocked when AKL_ENV=production.</span>
          </div>
          <div className="timeline-item">
            <ShieldCheck size={18} aria-hidden="true" />
            <strong>Policy hints</strong>
            <span>Frontend hides actions using Registry API authorization checks, not local authority.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
