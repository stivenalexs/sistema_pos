import "server-only";

import { EnvError, requireValue } from "./public-env";

// Server-only secrets. Importing this file from client code fails the build.

export type ServerEnv = {
  supabaseSecretKey: string;
};

type RawServerEnv = {
  SUPABASE_SECRET_KEY?: string | undefined;
};

export function parseServerEnv(raw: RawServerEnv): ServerEnv {
  const supabaseSecretKey = requireValue(
    "SUPABASE_SECRET_KEY",
    raw.SUPABASE_SECRET_KEY,
  );
  if (supabaseSecretKey.startsWith("sb_publishable_")) {
    throw new EnvError(
      "SUPABASE_SECRET_KEY contains a publishable key. Use the secret key (sb_secret_...).",
    );
  }
  return { supabaseSecretKey };
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
}
