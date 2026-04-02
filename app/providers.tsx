"use client";

import React, { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/context/AuthContext';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (typeof window === 'undefined') return;

    // Prevent stale dev behavior from persisted PWA worker/cache after API changes.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((reg) => reg.unregister())))
        .catch(() => undefined);
    }

    if ('caches' in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined);
    }
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}

export default Providers;
