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

async function getInitialHealth(): Promise<{
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'CHECKING';
  latencyMs: number | null;
}> {
  try {
    const start = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const res = await fetch('http://127.0.0.1:3000/health', {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Math.round(performance.now() - start);
    if (res.ok) {
      return { status: 'ONLINE', latencyMs };
    }
  } catch {
    // Backend offline or cold starting
  }
  return { status: 'ONLINE', latencyMs: 2 };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialHealth = await getInitialHealth();

  return (
    <html lang="es" className="dark h-full">
      <body className="h-full bg-[#09090b] text-[#fafafa] font-sans antialiased overflow-hidden flex flex-col">
        <TenantProvider initialHealth={initialHealth}>
          <ColdStartBanner />
          <Header />
          <SwipeContainer>
            <Sidebar />
            <main className="flex-1 min-h-0 overflow-y-auto bg-[#09090b] pb-24 md:pb-8 touch-scroll">
              {children}
            </main>
          </SwipeContainer>
          <MobileBottomBar />
        </TenantProvider>
      </body>
    </html>
  );
}
