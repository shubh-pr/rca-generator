import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../api/client';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void }) => string; reset: (id?: string) => void };
  }
}

export interface PublicConfig {
  turnstile_site_key: string | null;
  google_enabled: boolean;
  password_min_length: number;
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => api.get<PublicConfig>('/config/public'), staleTime: Infinity });
}

/** Cloudflare Turnstile widget; renders nothing unless the server enabled it. */
export function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const cfg = usePublicConfig();
  const el = useRef<HTMLDivElement>(null);
  const siteKey = cfg.data?.turnstile_site_key;
  useEffect(() => {
    if (!siteKey || !el.current) return;
    const render = () => el.current && window.turnstile?.render(el.current, { sitekey: siteKey, callback: onToken });
    if (window.turnstile) {
      render();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [siteKey, onToken]);
  if (!siteKey) return null;
  return <div ref={el} className="my-2" />;
}
