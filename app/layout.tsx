import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KlawHub Console — Self-Evolving AI Coworker",
  description: "Industry-standard, disruptive workspace coordinator and agent telemetry dashboard."
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
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="overflow-x-hidden">
        {/* Glow ambient background assets */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] ambient-glow-cyan" />
          <div className="absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] ambient-glow-purple" />
        </div>
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
