import { useEffect, useState } from 'react';

/** Set at build time (vite.config.ts). The deployed site also has version.json with the same id. */
export const BUILD_ID: string = __BUILD_ID__;
export const BUILD_TIME = BUILD_ID.split('+')[0];

/** True when the website has a newer build than the one running in this tab. */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!location.protocol.startsWith('http')) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(new URL('version.json', location.href), { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!stopped && build && build !== BUILD_ID) setAvailable(true);
      } catch {
        /* offline: try later */
      }
    };
    const first = setTimeout(check, 4000);
    const every = setInterval(check, 10 * 60 * 1000);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return available;
}
