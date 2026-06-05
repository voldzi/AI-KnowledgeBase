import Link from "next/link";
import { ArrowUpRight, FilePlus2, History, UploadCloud } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { AuthorizationHint, Document } from "@/lib/types";
import { documentTypeLabel, formatDateTime } from "@/lib/format";

interface DocumentRegistryProps {
  documents: Document[];
  authorization: AuthorizationHint;
}

export function DocumentRegistry({ documents, authorization }: DocumentRegistryProps) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Document registry</h2>
        <div className="inline-actions">
          {authorization.can_update ? (
            <Link className="button" href="/documents/new">
              <FilePlus2 size={16} aria-hidden="true" />
              New draft
            </Link>
          ) : null}
          {authorization.can_ingest ? (
            <Link className="button button--primary" href="/upload">
              <UploadCloud size={16} aria-hidden="true" />
              Upload version
            </Link>
          ) : null}
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Status</th>
            <th>Classification</th>
            <th>Owner</th>
            <th>Tags</th>
            <th>Updated</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.document_id}>
              <td>
                <span className="cell-title">
                  <strong>{document.title}</strong>
                  <span>{document.document_id} - {document.gestor_unit}</span>
                </span>
              </td>
              <td>{documentTypeLabel(document.document_type)}</td>
              <td>
                <StatusBadge value={document.status} />
              </td>
              <td>{document.classification}</td>
              <td>{document.owner_id}</td>
              <td>
                <span className="tag-list">
                  {document.tags.slice(0, 3).map((tag) => (
                    <span className="tag" key={tag}>{tag}</span>
                  ))}
                </span>
              </td>
              <td>{formatDateTime(document.updated_at)}</td>
              <td>
                <span className="inline-actions">
                  <Link className="icon-button" href={`/documents/${document.document_id}`} aria-label={`Open ${document.title}`}>
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                  <Link
                    className="icon-button"
                    href={`/documents/${document.document_id}#versions`}
                    aria-label={`View versions for ${document.title}`}
                  >
                    <History size={16} aria-hidden="true" />
                  </Link>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
