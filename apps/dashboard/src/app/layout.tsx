import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TenantProvider } from '../context/tenant-context';
import { Header } from '../components/layout/header';
import { Sidebar } from '../components/layout/sidebar';
import { MobileBottomBar } from '../components/layout/mobile-bottom-bar';
import { SwipeContainer } from '../components/layout/swipe-container';
import { ColdStartBanner } from '../components/layout/cold-start-banner';

export const metadata: Metadata = {
  title: 'HookRelay — Control Console',
  description:
    'Enterprise Event Dispatcher Engine & Webhook Delivery Console',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-icon.svg', type: 'image/svg+xml' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#09090b',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#09090b] text-[#fafafa] font-sans antialiased overflow-hidden flex flex-col">
        <TenantProvider>
          <ColdStartBanner />
          <Header />
          <SwipeContainer>
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-[#09090b] pb-20 md:pb-6">
              {children}
            </main>
          </SwipeContainer>
          <MobileBottomBar />
        </TenantProvider>
      </body>
    </html>
  );
}
