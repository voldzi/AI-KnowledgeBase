import type {
  ControlledDocumentPackageMember,
  ControlledDocumentPackageStatus,
} from "@/lib/types";

export type ControlledPackageMemberRole = "attachment" | "form" | "template";

export function controlledPackageDatesFromVersion(validFrom: string | null): {
  effectiveFrom: string | null;
  reviewDueOn: string | null;
} {
  const effectiveFrom = validFrom?.slice(0, 10) ?? null;
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { effectiveFrom: null, reviewDueOn: null };
  }
  const reviewDate = new Date(`${effectiveFrom}T00:00:00Z`);
  if (Number.isNaN(reviewDate.getTime())) {
    return { effectiveFrom: null, reviewDueOn: null };
  }
  reviewDate.setUTCFullYear(reviewDate.getUTCFullYear() + 1);
  return {
    effectiveFrom,
    reviewDueOn: reviewDate.toISOString().slice(0, 10),
  };
}

export function nextControlledPackageStatus(
  status: ControlledDocumentPackageStatus,
): ControlledDocumentPackageStatus | null {
  if (status === "draft") return "approved";
  if (status === "approved") return "valid";
  return null;
}

export function controlledPackageMemberRelation(
  role: ControlledPackageMemberRole,
): ControlledDocumentPackageMember["relation_type"] {
  if (role === "attachment") return "contains_attachment";
  if (role === "form") return "contains_form";
  return "contains_template";
}
