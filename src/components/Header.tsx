"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

const navLinks = [
  { label: "Features", href: "/#features" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Pricing", href: "/pricing" },
];

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-bg">
            <span className="text-lg font-bold text-white">K</span>
          </div>
          <span className="text-xl font-bold text-surface-900">Klawhub</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-surface-700 transition-colors hover:text-brand-600"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/install"
            className="rounded-full bg-surface-900 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-surface-800 hover:shadow-lg"
          >
            Add to Slack
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-lg p-2 text-surface-700 transition-colors hover:bg-surface-100 md:hidden"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-surface-200 bg-white px-6 py-4 md:hidden">
          <nav className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="text-sm font-medium text-surface-700 transition-colors hover:text-brand-600"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/install"
              onClick={() => setMobileOpen(false)}
              className="rounded-full bg-surface-900 px-5 py-2.5 text-center text-sm font-semibold text-white transition-all hover:bg-surface-800"
            >
              Add to Slack
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
