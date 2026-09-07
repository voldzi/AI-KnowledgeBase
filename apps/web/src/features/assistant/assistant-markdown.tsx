import type { ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMarkdown({ content, openLinkLabel }: { content: string; openLinkLabel: string }) {
  return <ReactMarkdown
    components={assistantMarkdownComponents(openLinkLabel)}
    remarkPlugins={[remarkGfm]}
    skipHtml
    urlTransform={(url, key) => key === "href" ? defaultUrlTransform(url) : ""}
  >{content}</ReactMarkdown>;
}

function assistantMarkdownComponents(openLinkLabel: string): Components {
  return {
    // Render only the label: neither remote nor same-origin Markdown images
    // may initiate an automatic request with document-derived URL data.
    img({ alt }) {
      return alt ? <span>{alt}</span> : null;
    },
    a({ children, href }) {
      const hasLabel = hasMarkdownCellContent(children);
      const localNavigation = href?.startsWith("/") && !href.startsWith("//") && !href.includes("\\");
      return (
        <a href={href} target={localNavigation ? undefined : "_blank"} rel={localNavigation ? undefined : "noopener noreferrer"}>
          {hasLabel ? children : openLinkLabel}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="akb-chat-message__table-wrap">
          <table>{children}</table>
        </div>
      );
    },
    td({ children }) {
      return (
        <td>
          {hasMarkdownCellContent(children)
            ? children
            : <span className="akb-chat-message__empty-cell">neuvedeno</span>}
        </td>
      );
    },
  };
}

function hasMarkdownCellContent(children: ReactNode): boolean {
  if (children === null || children === undefined || children === false) {
    return false;
  }
  if (typeof children === "string" || typeof children === "number") {
    return String(children).trim().length > 0;
  }
  if (Array.isArray(children)) {
    return children.some((child) => hasMarkdownCellContent(child));
  }
  return true;
}
