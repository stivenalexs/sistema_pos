import "server-only";

import { EnvError, requireValue } from "@/shared/env/public-env";

// Factus API client (D-043, D-044). Sources: developers.factus.com.co and the
// official skill .claude/skills/facturas-crear-y-validar.
//   POST /oauth/token  grant_type=password | refresh_token (form-encoded)
//   POST /v2/bills/validate, POST /v2/credit-notes/validate (JSON, Bearer)

export type FactusEnvironment = "sandbox" | "production";

export type FactusConfig = {
  environment: FactusEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  numberingRangeId: number | null;
};

const BASE_URLS: Record<FactusEnvironment, string> = {
  sandbox: "https://api-sandbox.factus.com.co",
  production: "https://api.factus.com.co",
};

export function parseFactusConfig(raw: Record<string, string | undefined>): FactusConfig {
  const environment = requireValue("FACTUS_ENV", raw.FACTUS_ENV);
  if (environment !== "sandbox" && environment !== "production") {
    throw new EnvError('FACTUS_ENV must be "sandbox" or "production".');
  }
  const range = raw.FACTUS_NUMBERING_RANGE_ID?.trim();
  if (range && !/^\d+$/.test(range)) {
    throw new EnvError("FACTUS_NUMBERING_RANGE_ID must be a number.");
  }
  return {
    environment,
    baseUrl: BASE_URLS[environment],
    clientId: requireValue("FACTUS_CLIENT_ID", raw.FACTUS_CLIENT_ID),
    clientSecret: requireValue("FACTUS_CLIENT_SECRET", raw.FACTUS_CLIENT_SECRET),
    username: requireValue("FACTUS_USERNAME", raw.FACTUS_USERNAME),
    password: requireValue("FACTUS_PASSWORD", raw.FACTUS_PASSWORD),
    numberingRangeId: range ? Number(range) : null,
  };
}

export function getFactusConfig(): FactusConfig {
  return parseFactusConfig({
    FACTUS_ENV: process.env.FACTUS_ENV,
    FACTUS_CLIENT_ID: process.env.FACTUS_CLIENT_ID,
    FACTUS_CLIENT_SECRET: process.env.FACTUS_CLIENT_SECRET,
    FACTUS_USERNAME: process.env.FACTUS_USERNAME,
    FACTUS_PASSWORD: process.env.FACTUS_PASSWORD,
    FACTUS_NUMBERING_RANGE_ID: process.env.FACTUS_NUMBERING_RANGE_ID,
  });
}

type Token = { accessToken: string; refreshToken: string | null; expiresAt: number };

export type FactusResponse = { status: number; body: unknown };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Transient failure (network, 5xx, 429): the worker retries with backoff. */
export class FactusTransientError extends Error {
  override name = "FactusTransientError";
}

/**
 * Keeps the token in memory, renews it before it expires (using the
 * expires_in of each answer, since the docs disagree on its length) and
 * retries a request ONCE after a 401 with a fresh token.
 */
export class FactusClient {
  private token: Token | null = null;

  constructor(
    private readonly config: FactusConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async requestToken(form: Record<string, string>): Promise<Token> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/oauth/token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          ...(this.token && form.grant_type === "refresh_token"
            ? { Authorization: `Bearer ${this.token.accessToken}` }
            : {}),
        },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new FactusTransientError("factus_token_network_error");
    }
    if (!response.ok) {
      if (response.status >= 500) throw new FactusTransientError(`factus_token_${response.status}`);
      throw new Error(`factus_token_rejected_${response.status}`);
    }
    const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("factus_token_missing");
    const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 600;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      // Renew 60 s early.
      expiresAt: this.now() + Math.max(seconds - 60, 30) * 1000,
    };
  }

  private async login(): Promise<Token> {
    return this.requestToken({
      grant_type: "password",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.username,
      password: this.config.password,
    });
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > this.now()) {
      return this.token.accessToken;
    }
    if (this.token?.refreshToken) {
      try {
        this.token = await this.requestToken({
          grant_type: "refresh_token",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: this.token.refreshToken,
        });
        return this.token.accessToken;
      } catch (error) {
        if (error instanceof FactusTransientError) throw error;
        // Refresh token rejected: log in again.
      }
    }
    this.token = await this.login();
    return this.token.accessToken;
  }

  async post(path: string, payload: unknown): Promise<FactusResponse> {
    const send = async (token: string) => {
      try {
        return await this.fetchImpl(`${this.config.baseUrl}${path}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new FactusTransientError("factus_network_error");
      }
    };

    let response = await send(await this.getToken());
    if (response.status === 401) {
      // Expired or revoked token: renew and retry once.
      response = await send(await this.getToken(true));
    }
    if (response.status >= 500 || response.status === 429) {
      throw new FactusTransientError(`factus_http_${response.status}`);
    }
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }
}

let shared: FactusClient | null = null;

/** One client per server process, so the token is reused between jobs. */
export function getFactusClient(): FactusClient {
  shared ??= new FactusClient(getFactusConfig());
  return shared;
}
