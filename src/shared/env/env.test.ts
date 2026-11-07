import { describe, expect, it } from "vitest";

import { EnvError, parsePublicEnv } from "./public-env";
import { parseServerEnv, parseWorkerSecret } from "./server-env";

describe("parseWorkerSecret", () => {
  it("accepts a long secret", () => {
    expect(parseWorkerSecret("k".repeat(32))).toBe("k".repeat(32));
  });

  it("rejects a missing or short secret", () => {
    expect(() => parseWorkerSecret(undefined)).toThrow(/WORKER_SECRET/);
    expect(() => parseWorkerSecret("short")).toThrow(/at least 32/);
  });
});

const VALID_PUBLIC = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
};

describe("parsePublicEnv", () => {
  it("returns the values when they are valid", () => {
    expect(parsePublicEnv(VALID_PUBLIC)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "sb_publishable_example",
    });
  });

  it("fails with the variable name when one is missing", () => {
    expect(() =>
      parsePublicEnv({ ...VALID_PUBLIC, NEXT_PUBLIC_SUPABASE_URL: undefined }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("treats blank values as missing", () => {
    expect(() =>
      parsePublicEnv({
        ...VALID_PUBLIC,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   ",
      }),
    ).toThrow(EnvError);
  });

  it("rejects an invalid URL", () => {
    expect(() =>
      parsePublicEnv({ ...VALID_PUBLIC, NEXT_PUBLIC_SUPABASE_URL: "not a url" }),
    ).toThrow(/API URL/);
  });

  it("rejects the database URL in place of the API URL", () => {
    expect(() =>
      parsePublicEnv({
        ...VALID_PUBLIC,
        NEXT_PUBLIC_SUPABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      }),
    ).toThrow(/not the database URL/);
  });

  it("refuses a secret key in the public variable", () => {
    expect(() =>
      parsePublicEnv({
        ...VALID_PUBLIC,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_example",
      }),
    ).toThrow(/secret key/);
  });
});

describe("parseServerEnv", () => {
  it("returns the secret key", () => {
    expect(parseServerEnv({ SUPABASE_SECRET_KEY: "sb_secret_example" })).toEqual(
      { supabaseSecretKey: "sb_secret_example" },
    );
  });

  it("fails when the secret key is missing", () => {
    expect(() => parseServerEnv({})).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("refuses a publishable key in the secret variable", () => {
    expect(() =>
      parseServerEnv({ SUPABASE_SECRET_KEY: "sb_publishable_example" }),
    ).toThrow(/publishable key/);
  });
});
