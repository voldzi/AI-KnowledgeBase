# Markdown preview fixture

## Scope

This fixture verifies that Markdown sources are rendered as structured documents, not only as plain text.

## Checklist

- render headings into document contents,
- render bullet lists,
- render GFM tables,
- keep code blocks readable.

| Area | Status |
| --- | --- |
| Headings | Ready |
| Tables | Ready |
| Code blocks | Ready |

## Citation target

Markdown citation text should be highlighted inside the rendered document.

```text
viewer_mode: markdown
source_context: highlighted
```
