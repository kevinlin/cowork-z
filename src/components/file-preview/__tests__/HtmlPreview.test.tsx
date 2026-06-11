import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HtmlPreview } from '../HtmlPreview';

function getIframe(container: HTMLElement): HTMLIFrameElement {
  const iframe = container.querySelector('iframe');
  if (!iframe) throw new Error('iframe not rendered');
  return iframe;
}

describe('HtmlPreview', () => {
  it('does not grant popup or sandbox-escape permissions', () => {
    const { container } = render(<HtmlPreview content="<p>hello</p>" />);
    const sandbox = getIframe(container).getAttribute('sandbox') ?? '';

    expect(sandbox).not.toContain('allow-popups');
    expect(sandbox).not.toContain('allow-popups-to-escape-sandbox');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('injects base href into the head', () => {
    const { container } = render(<HtmlPreview baseHref="asset://localhost/dir/" content="<head></head><p>hi</p>" />);
    const srcDoc = getIframe(container).getAttribute('srcdoc') ?? '';

    expect(srcDoc).toContain('<base href="asset://localhost/dir/" />');
  });

  it('escapes quotes in baseHref so it cannot break out of the attribute', () => {
    const malicious = 'dir/" onload="alert(1)';
    const { container } = render(<HtmlPreview baseHref={malicious} content="<head></head><p>hi</p>" />);
    const srcDoc = getIframe(container).getAttribute('srcdoc') ?? '';

    expect(srcDoc).not.toContain('" onload="');
    expect(srcDoc).toContain('&quot;');
  });

  it('escapes angle brackets in baseHref', () => {
    const malicious = 'dir/<script>alert(1)</script>';
    const { container } = render(<HtmlPreview baseHref={malicious} content="<head></head><p>hi</p>" />);
    const srcDoc = getIframe(container).getAttribute('srcdoc') ?? '';

    expect(srcDoc).not.toContain('<base href="dir/<script>');
    expect(srcDoc).toContain('&lt;script&gt;');
  });
});
