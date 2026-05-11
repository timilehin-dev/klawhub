'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// This component will fetch the session status on the client side
export function SessionChecker() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkSession() {
      try {
        // Make an API call to check the session status
        // This API route will handle reading cookies on the server side
        // and return whether the user is logged in.
        const response = await fetch('/api/check-session');
        const data = await response.json();
        setIsLoggedIn(data.isLoggedIn);
      } catch (error) {
        console.error('Failed to check session:', error);
        setIsLoggedIn(false);
      } finally {
        setLoading(false);
      }
    }
    checkSession();
  }, []);

  if (loading) {
    // Optionally render a loading state or null
    return null;
  }

  return (
    <>
      {isLoggedIn ? (
        <Link
          href="/dashboard"
          className="group inline-flex items-center gap-2 rounded-full gradient-bg px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
        >
          Go to Dashboard
          <ArrowRight
            size={18}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ) : (
        <Link
          href="/install"
          className="group inline-flex items-center gap-2 rounded-full gradient-bg px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition-all hover:shadow-xl hover:shadow-brand-500/30 hover:brightness-110"
        >
          Add to Slack — Free
          <ArrowRight
            size={18}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      )}
    </>
  );
}
