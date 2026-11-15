import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HookRelay — Control Console",
  description: "Enterprise Event Dispatcher Engine & Webhook Infrastructure",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[#09090b] text-[#fafafa] antialiased">
        {children}
      </body>
    </html>
  );
}
