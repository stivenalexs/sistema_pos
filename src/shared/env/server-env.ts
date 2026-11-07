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

const MIN_WORKER_SECRET_LENGTH = 32;

/** Shared secret that pg_cron sends to the worker endpoint (D-034). */
export function parseWorkerSecret(value: string | undefined): string {
  const secret = requireValue("WORKER_SECRET", value);
  if (secret.length < MIN_WORKER_SECRET_LENGTH) {
    throw new EnvError(
      `WORKER_SECRET must have at least ${MIN_WORKER_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

export function getWorkerSecret(): string {
  return parseWorkerSecret(process.env.WORKER_SECRET);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
}
