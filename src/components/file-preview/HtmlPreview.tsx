interface HtmlPreviewProps {
  content: string;
  baseHref?: string;
}

/** HTML-encode a value for safe interpolation into an HTML attribute. */
function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function HtmlPreview({ content, baseHref }: HtmlPreviewProps) {
  let finalContent = content;

  if (baseHref) {
    // Escape before interpolation so a directory name containing quotes
    // cannot break out of the attribute (technical review finding #5)
    const safeHref = escapeHtmlAttribute(baseHref);
    const withBase = content.replace(/<head>/i, `<head>\n<base href="${safeHref}" />`);
    finalContent = withBase.includes('<base') ? withBase : `<base href="${safeHref}" />\n${content}`;
  }

  return (
    <div className="h-full w-full bg-white">
      {/*
        Sandbox deliberately omits allow-popups / allow-popups-to-escape-sandbox:
        agent-authored HTML must not be able to window.open() its way out of the
        sandbox (technical review finding #5). allow-scripts runs in an opaque
        origin (no allow-same-origin), so the preview cannot reach Tauri APIs.
        Use the "open externally" action for full-fidelity rendering.
      */}
      <iframe
        className="h-full w-full border-none"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms"
        srcDoc={finalContent}
        title="HTML Preview"
      />
    </div>
  );
}
