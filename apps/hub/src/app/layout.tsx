import type { ReactNode } from 'react';
import BackLink from '@shared/back-link';
import './app.css';

export const metadata = { title: 'devteam hub' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <BackLink />
        {children}
      </body>
    </html>
  );
}
