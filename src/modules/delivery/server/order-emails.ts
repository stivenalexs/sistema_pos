import "server-only";

import { formatCop } from "@/modules/pricing";
import { PermanentActionError } from "@/shared/actions/server/worker";
import { getEmailConfig, sendEmail } from "@/shared/email/send-email";
import type { EmailConfig } from "@/shared/email/email-config";
import { createSupabaseAdminClient } from "@/shared/supabase/admin";

import { isReturnEmailTemplate, renderReturnEmail } from "../domain/return-emails";

// Worker of the send_email action (D-068): emails the customer of an order
// after a failed delivery. Runs only in the worker, never in a request
// (D-017). The queue retries SMTP errors with backoff; a bad payload or a
// missing order fails at once.

type EmailData = {
  order_id: string;
  email: string | null;
  customer_name: string;
  refund_amount_cop: number | null;
  return_choice_deadline: string | null;
  scheduled_delivery_on: string | null;
  failure_reason: string | null;
};

type Deps = {
  loadData?: (orderId: string) => Promise<EmailData | null>;
  send?: typeof sendEmail;
  config?: EmailConfig;
};

const DEADLINE = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("es-CO", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const clean = (value: string) => value.replace(/ | /g, " ");

async function loadEmailData(orderId: string): Promise<EmailData | null> {
  const { data, error } = await createSupabaseAdminClient().rpc("order_email_data", { p_order_id: orderId });
  if (error) throw new Error(`order_email_data failed: ${error.message}`);
  return (data as EmailData | null) ?? null;
}

export async function sendOrderEmail(payload: unknown, deps: Deps = {}): Promise<{ sent: true; messageId: string }> {
  const value = payload as { template?: unknown; order_id?: unknown } | null;
  if (!value || !isReturnEmailTemplate(value.template) || typeof value.order_id !== "string") {
    throw new PermanentActionError("invalid_payload");
  }
  const data = await (deps.loadData ?? loadEmailData)(value.order_id);
  if (!data) throw new PermanentActionError("order_not_found");
  if (!data.email) throw new PermanentActionError("customer_without_email");

  const config = deps.config ?? getEmailConfig();
  const orderPath = `/orders/${data.order_id}`;
  const message = renderReturnEmail({
    template: value.template,
    customerName: data.customer_name,
    orderNumber: data.order_id.slice(0, 8).toUpperCase(),
    failureReason: data.failure_reason,
    deadlineText: data.return_choice_deadline ? clean(DEADLINE.format(new Date(data.return_choice_deadline))) : null,
    // A date (no time): formatted in UTC so the day never shifts.
    scheduledText: data.scheduled_delivery_on
      ? clean(DAY.format(new Date(`${data.scheduled_delivery_on}T00:00:00Z`)))
      : null,
    refundText: data.refund_amount_cop != null ? formatCop(data.refund_amount_cop) : null,
    orderUrl: config.appUrl ? `${config.appUrl}${orderPath}` : null,
    orderPath,
  });

  const { messageId } = await (deps.send ?? sendEmail)({ to: data.email, ...message }, config);
  return { sent: true, messageId };
}
