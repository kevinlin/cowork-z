import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              const langMatch = /language-(\w+)/.exec(className || '');
              if (langMatch) {
                return (
                  <div className="overflow-hidden rounded-lg border border-border bg-muted/50">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/70 px-3 py-2">
                      <span className="h-2 w-2 rounded-full bg-red-400/80" />
                      <span className="h-2 w-2 rounded-full bg-yellow-400/80" />
                      <span className="h-2 w-2 rounded-full bg-green-400/80" />
                      <span className="ml-2 text-[0.65rem] uppercase tracking-widest text-muted-foreground">{langMatch[1]}</span>
                    </div>
                    <SyntaxHighlighter
                      customStyle={{ margin: 0, background: 'transparent', padding: '1rem' }}
                      language={langMatch[1]}
                      PreTag="div"
                      style={oneDark}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  </div>
                );
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
          }}
          remarkPlugins={[remarkGfm]}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
