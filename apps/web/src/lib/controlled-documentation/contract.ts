import type {
  ControlledDocumentPackageMember,
  ControlledDocumentPackageStatus,
} from "@/lib/types";

export type ControlledPackageMemberRole = "attachment" | "form" | "template";

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
