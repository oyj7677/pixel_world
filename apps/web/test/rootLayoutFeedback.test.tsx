import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RootLayout from '../src/app/layout';

describe('RootLayout feedback entry', () => {
  it('exposes the Kakao Open Chat feedback link globally', () => {
    const html = renderToStaticMarkup(
      RootLayout({ children: createElement('main', null, 'screen content') })
    );

    expect(html).toContain('aria-label="피드백 보내기"');
    expect(html).toContain('href="https://open.kakao.com/o/sVe6cZvi"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
