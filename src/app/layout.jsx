'use client';

import { useEffect, useState } from 'react';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';

export default function RootLayout({ children }) {
  const [isElectronMac, setIsElectronMac] = useState(false);

  useEffect(() => {
    if (window.electronAPI?.isElectron && window.electronAPI.platform === 'darwin') {
      setIsElectronMac(true);
    }
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>AI Enterprise - AI Company Management</title>
        <meta name="description" content="Recruit AI Agents to form departments and collaborate on real projects" />
      </head>
      <body className={`min-h-screen ${isElectronMac ? 'electron-mac' : ''}`}>
        {isElectronMac && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              height: 36,
              zIndex: 9999,
              WebkitAppRegion: 'drag',
            }}
          />
        )}
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
