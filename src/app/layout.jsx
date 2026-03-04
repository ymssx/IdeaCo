'use client';

import './globals.css';
import { I18nProvider } from '@/lib/i18n';

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>AI Enterprise - AI Company Management</title>
        <meta name="description" content="Recruit AI Agents to form departments and collaborate on real projects" />
      </head>
      <body className="min-h-screen">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
