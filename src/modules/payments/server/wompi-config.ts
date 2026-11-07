import "server-only";

import { EnvError, requireValue } from "@/shared/env/public-env";

// Wompi configuration (D-040). Sandbox and production keys are never mixed:
// every key must carry the prefix of WOMPI_ENV, or the app refuses to start.
// Source: https://docs.wompi.co/en/docs/colombia/ambientes-y-llaves/

export type WompiEnvironment = "sandbox" | "production";

export type WompiConfig = {
  environment: WompiEnvironment;
  apiUrl: string;
  checkoutUrl: string;
  publicKey: string;
  privateKey: string;
  eventsSecret: string;
  integritySecret: string;
};

const PREFIXES: Record<WompiEnvironment, Record<"publicKey" | "privateKey" | "eventsSecret" | "integritySecret", string>> = {
  sandbox: {
    publicKey: "pub_test_",
    privateKey: "prv_test_",
    eventsSecret: "test_events_",
    integritySecret: "test_integrity_",
  },
  production: {
    publicKey: "pub_prod_",
    privateKey: "prv_prod_",
    eventsSecret: "prod_events_",
    integritySecret: "prod_integrity_",
  },
};

const API_URLS: Record<WompiEnvironment, string> = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
};

// The web checkout host is the same for both environments; the public key
// decides which one is used.
const CHECKOUT_URL = "https://checkout.wompi.co/p/";

type RawWompiEnv = {
  WOMPI_ENV?: string | undefined;
  WOMPI_PUBLIC_KEY?: string | undefined;
  WOMPI_PRIVATE_KEY?: string | undefined;
  WOMPI_EVENTS_SECRET?: string | undefined;
  WOMPI_INTEGRITY_SECRET?: string | undefined;
};

export function parseWompiConfig(raw: RawWompiEnv): WompiConfig {
  const environment = requireValue("WOMPI_ENV", raw.WOMPI_ENV);
  if (environment !== "sandbox" && environment !== "production") {
    throw new EnvError('WOMPI_ENV must be "sandbox" or "production".');
  }
  const prefixes = PREFIXES[environment];

  const values = {
    publicKey: requireValue("WOMPI_PUBLIC_KEY", raw.WOMPI_PUBLIC_KEY),
    privateKey: requireValue("WOMPI_PRIVATE_KEY", raw.WOMPI_PRIVATE_KEY),
    eventsSecret: requireValue("WOMPI_EVENTS_SECRET", raw.WOMPI_EVENTS_SECRET),
    integritySecret: requireValue("WOMPI_INTEGRITY_SECRET", raw.WOMPI_INTEGRITY_SECRET),
  };
  for (const [name, value] of Object.entries(values) as [keyof typeof values, string][]) {
    if (!value.startsWith(prefixes[name])) {
      // Never print the value: only which variable is wrong.
      throw new EnvError(
        `Wompi ${name} does not match WOMPI_ENV=${environment} (expected prefix ${prefixes[name]}). Sandbox and production keys must not be mixed.`,
      );
    }
  }

  return {
    environment,
    apiUrl: API_URLS[environment],
    checkoutUrl: CHECKOUT_URL,
    ...values,
  };
}

export function getWompiConfig(): WompiConfig {
  return parseWompiConfig({
    WOMPI_ENV: process.env.WOMPI_ENV,
    WOMPI_PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY,
    WOMPI_PRIVATE_KEY: process.env.WOMPI_PRIVATE_KEY,
    WOMPI_EVENTS_SECRET: process.env.WOMPI_EVENTS_SECRET,
    WOMPI_INTEGRITY_SECRET: process.env.WOMPI_INTEGRITY_SECRET,
  });
}
