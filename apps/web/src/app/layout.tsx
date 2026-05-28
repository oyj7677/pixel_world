import type { Metadata } from 'next';
import { FeedbackLink } from '../components/FeedbackLink';
import './globals.css';

export const metadata: Metadata = {
  title: '픽셀 월드',
  description: '협력과 방해가 공존하는 실시간 픽셀 캔버스.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1939451186341076"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        {children}
        <FeedbackLink />
      </body>
    </html>
  );
}
