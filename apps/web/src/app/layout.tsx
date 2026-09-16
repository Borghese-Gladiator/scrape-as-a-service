import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scraper',
  description: 'Declarative web-scraping platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            Scraper
          </Link>
          <Link href="/">Definitions</Link>
          <Link href="/runs">Runs</Link>
          <Link href="/definitions/new">New definition</Link>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
