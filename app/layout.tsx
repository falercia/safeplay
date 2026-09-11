import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LangProvider } from "@/lib/i18n";

const SITE_URL = "https://safe-play-poc.vercel.app";
const DESCRIPTION = "Proteção infantil em chats de jogos: detecção longitudinal de padrões de risco (o padrão, não a frase), alerta parental em linguagem simples, revisão humana com justificativa e auditoria. Projeto de Impacto do MIT Professional Education, prova de conceito com dados sintéticos.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Safe Play", template: "%s · Safe Play" },
  description: DESCRIPTION,
  applicationName: "Safe Play",
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Safe Play",
    title: "Safe Play · proteção infantil em chats de jogos",
    description: DESCRIPTION,
    locale: "pt_BR",
  },
  twitter: { card: "summary_large_image", title: "Safe Play · proteção infantil em chats de jogos", description: DESCRIPTION },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050f26",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout: carrega em todas as páginas */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
