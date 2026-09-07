import type { DocumentProfileInput } from "@/lib/documents/document-profile";
import type { DocumentVersionProfileDraft } from "@/lib/documents/document-profile-validation";
import type { InformationPolicyBinding } from "@/lib/stratos/information-policy";

/** Display projection only. A selection is freshly prepared and admitted before intake. */
export interface ApprovedPublicSourceCollection {
  collectionId: string;
  revision: string;
  displayName: string;
  authorityDisplayName: string;
  ownerDisplayName: string;
  gestorDisplayName: string;
  reviewRuleLabel: string;
  profile: { id: "akb.official-public-reference"; revision: string };
  tlp: "TLP:CLEAR";
}

export interface PreparePublicSourceRequest {
  collectionId: string;
  expectedCollectionRevision: string;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface PreparedPublicSource {
  schemaVersion: "stratos-official-source-preparation-1";
  collectionId: string;
  collectionRevision: string;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  documentType: string;
  documentProfile: DocumentProfileInput;
  documentVersionProfile: DocumentVersionProfileDraft;
  informationPolicy: InformationPolicyBinding;
}
