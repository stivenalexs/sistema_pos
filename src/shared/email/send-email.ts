import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { type EmailConfig, parseEmailConfig } from "./email-config";

// Sends transactional email by SMTP (D-059, D-068). Only workers call this:
// emails never go out inside a user request (D-017). Locally, Mailpit.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let cached: { key: string; transporter: Transporter } | null = null;

export function getEmailConfig(): EmailConfig {
  return parseEmailConfig({
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_URL: process.env.APP_URL,
  });
}

function transporterFor(config: EmailConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.secure}:${config.auth?.user ?? ""}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.auth ? { auth: config.auth } : {}),
      }),
    };
  }
  return cached.transporter;
}

/** Sends one email. Throws on SMTP errors so the queue retries (D-034). */
export async function sendEmail(message: EmailMessage, config: EmailConfig = getEmailConfig()): Promise<{ messageId: string }> {
  const info = await transporterFor(config).sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { messageId: String(info.messageId ?? "") };
}
