import type { Metadata } from 'next';
import './globals.css';
import { TenantProvider } from '../context/tenant-context';
import { Header } from '../components/layout/header';
import { Sidebar } from '../components/layout/sidebar';
import { ColdStartBanner } from '../components/layout/cold-start-banner';

export const metadata: Metadata = {
  title: 'HookRelay — Control Console',
  description:
    'Enterprise Event Dispatcher Engine & Webhook Delivery Console',
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
          <div className="flex-1 flex overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-[#09090b]">
              {children}
            </main>
          </div>
        </TenantProvider>
      </body>
    </html>
  );
}
