"use client";

import React, { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/context/AuthContext';

const CACHE_RESET_KEY = 'ces_cache_reset_version';
const CACHE_RESET_VERSION = '2026-04-02-randomuuid-fix-v2';

function ensureRandomUuidSupport() {
  if (typeof window === 'undefined') return;

  const cryptoObj = window.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return;

  const fallbackRandomUuid = () => {
    const bytes = new Uint8Array(16);
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      cryptoObj.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}` as `${string}-${string}-${string}-${string}-${string}`;
  };

  try {
    if (cryptoObj) {
      Object.defineProperty(cryptoObj, 'randomUUID', {
        value: fallbackRandomUuid,
        configurable: true,
        writable: true,
      });
      return;
    }
  } catch (_err) {
    // Fall through to assignment fallback below.
  }

  try {
    (window as any).crypto = {
      ...((window as any).crypto || {}),
      randomUUID: fallbackRandomUuid as any,
    };
  } catch (_err) {
    // Ignore; if we cannot patch at runtime, app code still uses local ID fallback in forms.
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    ensureRandomUuidSupport();

    const runOneTimeCacheReset = async () => {
      let alreadyReset = false;
      try {
        alreadyReset = window.localStorage.getItem(CACHE_RESET_KEY) === CACHE_RESET_VERSION;
      } catch (_err) {
        alreadyReset = false;
      }

      if (alreadyReset) return;

      let changed = false;

      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          if (registrations.length > 0) changed = true;
          await Promise.all(registrations.map((reg) => reg.unregister()));
        } catch (_err) {
          // Ignore cleanup errors and continue.
        }
      }

      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          if (keys.length > 0) changed = true;
          await Promise.all(keys.map((key) => caches.delete(key)));
        } catch (_err) {
          // Ignore cleanup errors and continue.
        }
      }

      try {
        window.localStorage.setItem(CACHE_RESET_KEY, CACHE_RESET_VERSION);
      } catch (_err) {
        // Ignore storage errors.
      }

      if (changed) {
        window.location.reload();
      }
    };

    void runOneTimeCacheReset();
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}

export default Providers;
