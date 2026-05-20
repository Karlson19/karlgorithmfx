import type { Metadata, Viewport } from 'next';
import './globals.css';
import PWARegistrar from '@/components/layout/PWARegistrar';

export const metadata: Metadata = {
  title: 'KarlgorithmFX — Multi-Pair Trading Dashboard',
  description: 'Multi-pair forex + gold analysis with AI-powered signals and real-time open-trade risk monitoring.',
  applicationName: 'KarlFX',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'KarlFX',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover', // edge-to-edge on notched phones
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        {/* Registers the service worker for PWA install + background push */}
        <PWARegistrar />
      </body>
    </html>
  );
}
