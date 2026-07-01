import { NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { requireApiAccess } from "@/lib/auth/server-route-guard";
import { readGovernanceSourceContent } from "@/lib/upload/governance-source-content";
import type { Document, DocumentVersion, GovernanceCitation } from "@/lib/types";

import { documentWorkflowBadRequest, documentWorkflowBridgeError } from "../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    documentId: string;
  }>;
}

interface ProposedDocumentInsight {
  insight_id: string;
  kind: "obligation" | "role" | "deadline" | "risk";
  title: string;
  summary: string;
  status: "proposed";
  confidence: "medium" | "low";
  citations: GovernanceCitation[];
  warnings: string[];
}

export async function POST(_: Request, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const requestContext = await getServerRequestContext();
    const forbidden = requireApiAccess(requestContext, "knowledge_workspace");
    if (forbidden) return forbidden;
    const clients = getServerApiClients();
    const [document, versions] = await Promise.all([
      clients.registry.getDocument(documentId, requestContext),
      clients.registry.listDocumentVersions(documentId, requestContext)
    ]);
    const currentVersion = versions.find((version) => version.status === "valid") ?? versions[0];

    if (!currentVersion) {
      return documentWorkflowBadRequest("Document has no version available for insight proposal.", 409);
    }

    const source = await sourceTextFor(document, currentVersion);
    const insights = proposeInsights(document, currentVersion, source.text, source.citation, source.warnings);

    return NextResponse.json({
      insights,
      source: {
        document_id: document.document_id,
        document_version_id: currentVersion.document_version_id,
        extracted: source.extracted,
        warnings: source.warnings
      },
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return documentWorkflowBridgeError(error);
  }
}

async function sourceTextFor(document: Document, version: DocumentVersion) {
  if (!version.source_file_uri) {
    const text = metadataText(document, version);
    return {
      text,
      extracted: false,
      warnings: ["SOURCE_FILE_URI_MISSING", "REGISTRY_METADATA_FALLBACK"],
      citation: citationFor(document, version, "Registry metadata fallback", text)
    };
  }

  const source = await readGovernanceSourceContent({
    document_id: document.document_id,
    document_version_id: version.document_version_id,
    source_file_uri: version.source_file_uri,
    file_hash: version.file_hash,
    viewer_mode: viewerModeForSourceUri(version.source_file_uri)
  });

  if (source.extracted && source.content) {
    return {
      text: source.content,
      extracted: true,
      warnings: source.warnings,
      citation: citationFor(document, version, "Extracted source", source.content)
    };
  }

  const fallback = metadataText(document, version);
  return {
    text: fallback,
    extracted: false,
    warnings: [...source.warnings, "REGISTRY_METADATA_FALLBACK"],
    citation: citationFor(document, version, "Registry metadata fallback", fallback)
  };
}

function proposeInsights(
  document: Document,
  version: DocumentVersion,
  sourceText: string,
  citation: GovernanceCitation,
  warnings: string[]
): ProposedDocumentInsight[] {
  const candidates = candidateSentences(sourceText);
  const groups = [
    {
      kind: "obligation" as const,
      title: "Obligations",
      keywords: ["must", "required", "shall", "povinn", "musí", "vyžaduje", "nesmí", "requires"],
      fallback: `Review normative requirements in ${document.title} before publication.`
    },
    {
      kind: "role" as const,
      title: "Roles and responsibilities",
      keywords: ["owner", "gestor", "approver", "reviewer", "auditor", "vlastník", "schvaluje", "role", "odpověd"],
      fallback: `Verify owner ${document.owner_id} and gestor ${document.gestor_unit ?? "n/a"} in Registry assignments.`
    },
    {
      kind: "deadline" as const,
      title: "Deadlines and validity",
      keywords: ["valid", "expiry", "deadline", "sla", "days", "platnost", "lhůt", "účinnost", "termín"],
      fallback: `Review validity ${version.valid_from ?? "n/a"} - ${version.valid_to ?? "n/a"} and SLA metadata.`
    },
    {
      kind: "risk" as const,
      title: "Risks and controls",
      keywords: ["risk", "failure", "conflict", "warning", "security", "rizik", "selh", "konflikt", "bezpeč", "nedostup"],
      fallback: `Check conflicts, sensitive classification and source extraction warnings for ${document.title}.`
    }
  ];

  return groups.map((group) => {
    const summary = bestSentence(candidates, group.keywords) ?? group.fallback;
    return {
      insight_id: `ins_${group.kind}_${version.document_version_id}`,
      kind: group.kind,
      title: group.title,
      summary,
      status: "proposed" as const,
      confidence: summary === group.fallback ? ("low" as const) : ("medium" as const),
      citations: [
        {
          ...citation,
          source_excerpt: summary.slice(0, 500)
        }
      ],
      warnings
    };
  });
}

function candidateSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?:\n{2,}|(?<=[.!?])\s+|^[-*]\s+)/)
    .map((item) => item.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter((item) => item.length >= 24 && item.length <= 500)
    .slice(0, 300);
}

function bestSentence(sentences: string[], keywords: string[]): string | null {
  let best: { sentence: string; score: number } | null = null;
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase();
    const score = keywords.reduce((total, keyword) => total + (normalized.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) {
      best = { sentence, score };
    }
  }
  return best?.sentence ?? null;
}

function metadataText(document: Document, version: DocumentVersion): string {
  return [
    `Title: ${document.title}`,
    `Document type: ${document.document_type}`,
    `Status: ${document.status}`,
    `Classification: ${document.classification}`,
    `Owner: ${document.owner_id}`,
    `Gestor unit: ${document.gestor_unit ?? "n/a"}`,
    `Version: ${version.version_label}`,
    `Version status: ${version.status}`,
    `Valid from: ${version.valid_from ?? "n/a"}`,
    `Valid to: ${version.valid_to ?? "n/a"}`,
    `Change summary: ${version.change_summary ?? "n/a"}`,
    `Tags: ${document.tags.join(", ") || "n/a"}`
  ].join("\n");
}

function citationFor(document: Document, version: DocumentVersion, section: string, excerptSource: string): GovernanceCitation {
  return {
    document_id: document.document_id,
    document_version_id: version.document_version_id,
    document_title: document.title,
    version_label: version.version_label,
    section_path: [section],
    page_number: null,
    chunk_id: `insight:${version.document_version_id}`,
    source_excerpt: excerptSource.replace(/\s+/g, " ").trim().slice(0, 500) || null
  };
}

function viewerModeForSourceUri(sourceUri: string): string {
  const normalized = sourceUri.toLowerCase();
  if (normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) return "markdown";
  if (normalized.endsWith(".csv") || normalized.endsWith(".xlsx")) return "table";
  if (normalized.endsWith(".doc") || normalized.endsWith(".docx") || normalized.endsWith(".txt")) return "text";
  if (normalized.endsWith(".pptx")) return "presentation";
  if (normalized.match(/\.(png|jpe?g|gif|webp|svg)$/)) return "image";
  return "binary";
}
