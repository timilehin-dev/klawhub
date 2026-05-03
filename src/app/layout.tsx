import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://klawhub.com"),
  title: "Klawhub — Your AI Coworker in Slack",
  description:
    "Multi-agent AI coworker that lives in Slack. Build tools, generate documents, conduct research, and analyze data — all from a single chat.",
  keywords: [
    "AI coworker",
    "Slack",
    "AI assistant",
    "multi-agent",
    "automation",
    "productivity",
    "code generation",
    "document generation",
  ],
  icons: {
    icon: "/favicon.png",
  },
  openGraph: {
    title: "Klawhub — Your AI Coworker in Slack",
    description:
      "Build, research, document, and analyze — all from Slack. Multi-agent AI that actually delivers.",
    type: "website",
    siteName: "Klawhub",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Klawhub — Your AI Coworker in Slack",
    description:
      "Build, research, document, and analyze — all from Slack. Multi-agent AI that actually delivers.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-white text-surface-900 antialiased">
        {children}
      </body>
    </html>
  );
}
