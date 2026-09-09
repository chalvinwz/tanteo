/**
 * Share tokens.
 *
 * The brief calls for capability URLs and no auth: whoever holds the link can
 * see the board. Taken literally that means one token in the URL, which also
 * means every spectator holds the credential that can overwrite the
 * tournament. A link pasted into a group chat should not be a write key.
 *
 * So there are two tokens, and only one of them ever leaves the organizer's
 * phone:
 *
 *   writeToken  32 random bytes, held only by the organizer's device.
 *   readToken   SHA-256 of the write token. This is what goes in the share URL.
 *
 * The server stores snapshots under the read token and, on a write, checks
 * that SHA-256 of the presented write token equals the read token in the path.
 * It therefore never stores a secret, needs no account, and still cannot be
 * written to by someone who only has the link. Reversing the read token to
 * recover the write token is a preimage attack on SHA-256.
 *
 * Both runtimes use the same code: WebCrypto is available in browsers and in
 * Node 19 and later, so there is one definition of the derivation rather than
 * two that could drift apart.
 */

/** Bytes of entropy in a write token. 32 bytes is 256 bits. */
const WRITE_TOKEN_BYTES = 32;

/** URL-safe base64 with the padding stripped, so a token drops into a path. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createWriteToken(): string {
  const bytes = new Uint8Array(WRITE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** The public half of a write token. Safe to publish; cannot be reversed. */
export async function deriveReadToken(writeToken: string): Promise<string> {
  const data = new TextEncoder().encode(writeToken);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Shape check only. A token that passes this may still be unknown to the
 * server; this exists so a malformed path is rejected before it reaches
 * storage, and so a token can never smuggle a path separator.
 */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

/**
 * Constant-time string comparison.
 *
 * The write check compares a derived digest against a value from the URL. A
 * fast path that returns on the first differing byte leaks, through timing,
 * how much of a guess was correct. Both inputs here are base64url of a fixed
 * length, so comparing lengths first is not itself a leak.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The path a viewer opens. Relative, so it works behind any host or proxy. */
export function shareUrlPath(readToken: string): string {
  return `/t/${readToken}`;
}
