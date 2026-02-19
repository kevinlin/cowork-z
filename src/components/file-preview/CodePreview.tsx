import { useSyncExternalStore } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { getLanguageFromExtension } from './preview-utils';

function subscribeToClassList(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getIsDark() {
  return document.documentElement.classList.contains('dark');
}

interface CodePreviewProps {
  content: string;
  extension: string | undefined;
}

export function CodePreview({ content, extension }: CodePreviewProps) {
  const isDark = useSyncExternalStore(subscribeToClassList, getIsDark);

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
        style={isDark ? oneDark : oneLight}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}
