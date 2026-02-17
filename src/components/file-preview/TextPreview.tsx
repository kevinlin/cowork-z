interface TextPreviewProps {
  content: string;
}

export function TextPreview({ content }: TextPreviewProps) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <pre className="whitespace-pre-wrap font-mono text-foreground text-sm">{content}</pre>
    </div>
  );
}
