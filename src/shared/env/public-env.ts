// Environment variables that are safe to ship to the browser.
// Next.js inlines NEXT_PUBLIC_* only when read literally as
// `process.env.NEXT_PUBLIC_NAME`, so each one is referenced by its full name.

export class EnvError extends Error {
  override name = "EnvError";
}

export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

type RawPublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string | undefined;
};

export function requireValue(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new EnvError(
      `Missing environment variable ${name}. See .env.example.`,
    );
  }
  return trimmed;
}

export function parsePublicEnv(raw: RawPublicEnv): PublicEnv {
  const supabaseUrl = requireValue(
    "NEXT_PUBLIC_SUPABASE_URL",
    raw.NEXT_PUBLIC_SUPABASE_URL,
  );
  // Must be the API URL (http/https), not the database URL (postgresql://).
  const protocol = URL.canParse(supabaseUrl)
    ? new URL(supabaseUrl).protocol
    : null;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new EnvError(
      "NEXT_PUBLIC_SUPABASE_URL must be the API URL (http:// or https://), not the database URL.",
    );
  }

  const supabasePublishableKey = requireValue(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  // A secret key in a NEXT_PUBLIC_ variable would be shipped to every browser
  // and bypass RLS. Refuse to start instead.
  if (supabasePublishableKey.startsWith("sb_secret_")) {
    throw new EnvError(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a secret key. Use the publishable key (sb_publishable_...).",
    );
  }

  return { supabaseUrl, supabasePublishableKey };
}

export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
