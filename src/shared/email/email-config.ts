// SMTP configuration for transactional emails (D-059, D-068). Read when an
// email is sent, never at import, so the build needs no secrets (D-030).
// Pure parsing: the caller passes process.env.

export class EmailConfigError extends Error {
  override name = "EmailConfigError";
}

export type EmailConfig = {
  host: string;
  port: number;
  /** TLS from the start (port 465). Otherwise STARTTLS when the server offers it. */
  secure: boolean;
  auth: { user: string; pass: string } | null;
  from: string;
  /** Public address of the store, for links in emails. Optional. */
  appUrl: string | null;
};

type RawEmailEnv = {
  SMTP_HOST?: string | undefined;
  SMTP_PORT?: string | undefined;
  SMTP_SECURE?: string | undefined;
  SMTP_USER?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
  EMAIL_FROM?: string | undefined;
  APP_URL?: string | undefined;
};

const blank = (value: string | undefined) => (value ?? "").trim() === "";

export function parseEmailConfig(raw: RawEmailEnv): EmailConfig {
  if (blank(raw.SMTP_HOST)) throw new EmailConfigError("SMTP_HOST is not set.");
  if (blank(raw.EMAIL_FROM)) throw new EmailConfigError("EMAIL_FROM is not set.");

  const port = blank(raw.SMTP_PORT) ? 587 : Number(raw.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EmailConfigError("SMTP_PORT must be a port number.");
  }

  // Both or neither: a half-configured login is an error, never sent as is.
  if (blank(raw.SMTP_USER) !== blank(raw.SMTP_PASSWORD)) {
    throw new EmailConfigError("SMTP_USER and SMTP_PASSWORD go together.");
  }

  let appUrl: string | null = null;
  if (!blank(raw.APP_URL)) {
    let url: URL;
    try {
      url = new URL(String(raw.APP_URL).trim());
    } catch {
      throw new EmailConfigError("APP_URL must be a URL.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new EmailConfigError("APP_URL must use http or https.");
    }
    appUrl = url.origin;
  }

  return {
    host: String(raw.SMTP_HOST).trim(),
    port,
    secure: (raw.SMTP_SECURE ?? "").trim().toLowerCase() === "true",
    auth: blank(raw.SMTP_USER)
      ? null
      : { user: String(raw.SMTP_USER).trim(), pass: String(raw.SMTP_PASSWORD) },
    from: String(raw.EMAIL_FROM).trim(),
    appUrl,
  };
}
