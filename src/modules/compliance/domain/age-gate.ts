// Entry age gate (D-035). The cookie only remembers that the visitor saw the
// notice and said they are of age; it does NOT replace the verification made
// at sign-up.

export const AGE_GATE_COOKIE = "age_gate_ok";
export const AGE_GATE_COOKIE_VALUE = "1";
export const AGE_GATE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const AGE_GATE_PATH = "/age-check";

/**
 * Path segments reachable without passing the age gate: the gate itself,
 * machine endpoints (workers, webhooks) and the email confirmation link.
 * Matched by whole segment, so "/age-checkout" is NOT exempt.
 */
const EXEMPT_SEGMENTS = [AGE_GATE_PATH, "/api", "/auth"];

export function isAgeGateExempt(pathname: string): boolean {
  return EXEMPT_SEGMENTS.some(
    (segment) => pathname === segment || pathname.startsWith(`${segment}/`),
  );
}

export function hasPassedAgeGate(cookieValue: string | undefined): boolean {
  return cookieValue === AGE_GATE_COOKIE_VALUE;
}

/**
 * Keeps only internal paths for the "next" redirect, so that the gate cannot
 * be used to send visitors to another site (open redirect).
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  // Browsers drop tabs and line breaks from URLs (WHATWG), so "/<tab>/evil.example"
  // would become "//evil.example": refuse any control character (D-072).
  if (/[\u0000-\u001F\u007F]/.test(value)) return "/";
  // Last check: resolved as a URL, it must stay on the same origin.
  try {
    const base = "http://internal.invalid";
    if (new URL(value, base).origin !== base) return "/";
  } catch {
    return "/";
  }
  if (value.startsWith(AGE_GATE_PATH)) return "/";
  return value;
}
