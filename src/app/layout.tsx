import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Klawhub — Your AI Coworker",
  description: "Multi-agent AI coworker that lives in Slack. Build tools, generate documents, conduct research, and analyze data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
