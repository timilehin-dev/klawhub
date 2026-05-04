import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-surface-200 bg-surface-50">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:py-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-bg">
                <span className="text-lg font-bold text-white">K</span>
              </div>
              <span className="text-xl font-bold text-surface-900">
                Klawhub
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-surface-700">
              Multi-agent AI coworker that lives in your Slack workspace.
              Build, research, document, and analyze — all from chat.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold text-surface-900">Product</h4>
            <ul className="mt-3 space-y-2.5">
              <li>
                <Link
                  href="/#features"
                  className="text-sm text-surface-700 transition-colors hover:text-brand-600"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="text-sm text-surface-700 transition-colors hover:text-brand-600"
                >
                  Pricing
                </Link>
              </li>
              <li>
                <Link
                  href="/install"
                  className="text-sm text-surface-700 transition-colors hover:text-brand-600"
                >
                  Install
                </Link>
              </li>
            </ul>
          </div>

          {/* Capabilities */}
          <div>
            <h4 className="text-sm font-semibold text-surface-900">Capabilities</h4>
            <ul className="mt-3 space-y-2.5">
              <li>
                <span className="text-sm text-surface-700">Code Builder</span>
              </li>
              <li>
                <span className="text-sm text-surface-700">Document Generator</span>
              </li>
              <li>
                <span className="text-sm text-surface-700">Research Agent</span>
              </li>
              <li>
                <span className="text-sm text-surface-700">Data Analyst</span>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-surface-900">Company</h4>
            <ul className="mt-3 space-y-2.5">
              <li>
                <span className="text-sm text-surface-700">About</span>
              </li>
              <li>
                <span className="text-sm text-surface-700">Privacy Policy</span>
              </li>
              <li>
                <span className="text-sm text-surface-700">Terms of Service</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-surface-200 pt-6">
          <p className="text-center text-sm text-surface-700">
            &copy; {new Date().getFullYear()} Klawhub. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
