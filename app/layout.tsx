import type { Metadata, Viewport } from 'next';
import Providers from './providers';
import { Outfit } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CITE | COLLEGE EVALUATION SYSTEM',
  description: 'College of Information Technology Education Evaluation System',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192x192.png',
    apple: '/icon-512x512.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#6d28d9',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={outfit.className}>
        <Script src="/crypto-randomuuid-polyfill.js" strategy="beforeInteractive" />
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
