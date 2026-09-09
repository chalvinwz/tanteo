/**
 * Where the share API lives, and whether there is one at all.
 *
 * Two deployments exist and they differ in exactly this. Self-hosted, the
 * container serves the client and the API from one origin, so the API is a path
 * under wherever the app is mounted. On GitHub Pages there is no server at all:
 * Pages is static, so scoring works offline exactly as designed and sharing
 * simply is not available.
 *
 * That second case is the reason this module exists. Without it the organizer
 * would mint a share link, hand it to the group chat, and only find out it was
 * dead when nobody could open it. An honest "not on this deployment" beats a
 * link that silently goes nowhere.
 */

/** Absolute API origin, if this build was pointed at a separate server. */
const CONFIGURED = import.meta.env['VITE_TANTEO_API'] as string | undefined;

/** Same-origin default, under the app's mount point. */
const BASE = import.meta.env.BASE_URL || '/';

export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path.slice(1) : path;
  if (CONFIGURED) return `${CONFIGURED.replace(/\/$/, '')}/${suffix}`;
  return `${BASE}${suffix}`;
}

/**
 * Whether a share server is reachable, asked once and remembered.
 *
 * Deliberately not cached as a negative forever: an organizer whose phone had
 * no signal when the app opened should not be told sharing is impossible for
 * the rest of the evening. A failure is forgotten so the next attempt asks
 * again; only a definite yes sticks.
 */
let known: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

export async function shareServerAvailable(): Promise<boolean> {
  if (known === true) return true;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch(apiUrl('api/health'), { cache: 'no-store' });
      const ok = response.ok;
      if (ok) known = true;
      return ok;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
