import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { getLanguageFromExtension } from './preview-utils';

interface CodePreviewProps {
  content: string;
  extension: string | undefined;
}

export function CodePreview({ content, extension }: CodePreviewProps) {
  return (
    <div className="h-full overflow-y-auto">
      <SyntaxHighlighter
        customStyle={{
          margin: 0,
          padding: '1.5rem',
          background: 'transparent',
          fontSize: '0.8125rem',
        }}
        language={getLanguageFromExtension(extension)}
        showLineNumbers
        style={oneDark}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}
