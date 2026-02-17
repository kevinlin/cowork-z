interface HtmlPreviewProps {
  content: string;
  baseHref?: string;
}

export function HtmlPreview({ content, baseHref }: HtmlPreviewProps) {
  let finalContent = content;

  if (baseHref) {
    const withBase = content.replace(/<head>/i, `<head>\n<base href="${baseHref}" />`);
    finalContent = withBase.includes('<base') ? withBase : `<base href="${baseHref}" />\n${content}`;
  }

  return (
    <div className="h-full w-full bg-white">
      <iframe
        className="h-full w-full border-none"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
        srcDoc={finalContent}
        title="HTML Preview"
      />
    </div>
  );
}
