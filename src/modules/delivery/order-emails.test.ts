import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/shared/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/modules/pricing", () => ({
  formatCop: (value: number) => `$ ${value.toLocaleString("es-CO")}`,
}));

import { PermanentActionError } from "@/shared/actions/server/worker";
import { EmailConfigError, parseEmailConfig } from "@/shared/email/email-config";

import { renderReturnEmail } from "./domain/return-emails";
import { sendOrderEmail } from "./server/order-emails";

const CONFIG = parseEmailConfig({ SMTP_HOST: "127.0.0.1", SMTP_PORT: "54325", EMAIL_FROM: "La Cava <pedidos@lacava.test>", APP_URL: "http://localhost:3000/" });

const DATA = {
  order_id: "abcdef12-0000-4000-8000-000000000001",
  email: "cliente@test.local",
  customer_name: "Ana <Pérez>",
  refund_amount_cop: 45000,
  return_choice_deadline: "2026-11-24T20:40:00Z",
  scheduled_delivery_on: "2026-11-22",
  failure_reason: "inaccessible_location",
};

describe("parseEmailConfig (D-068)", () => {
  it("reads host, port, sender and the app origin", () => {
    expect(CONFIG).toMatchObject({ host: "127.0.0.1", port: 54325, secure: false, auth: null, appUrl: "http://localhost:3000" });
  });
  it("fails without host or sender, with a bad port or half a login", () => {
    expect(() => parseEmailConfig({ EMAIL_FROM: "a@b.co" })).toThrow(EmailConfigError);
    expect(() => parseEmailConfig({ SMTP_HOST: "h" })).toThrow(EmailConfigError);
    expect(() => parseEmailConfig({ SMTP_HOST: "h", EMAIL_FROM: "a@b.co", SMTP_PORT: "99999" })).toThrow(EmailConfigError);
    expect(() => parseEmailConfig({ SMTP_HOST: "h", EMAIL_FROM: "a@b.co", SMTP_USER: "u" })).toThrow(EmailConfigError);
    expect(() => parseEmailConfig({ SMTP_HOST: "h", EMAIL_FROM: "a@b.co", APP_URL: "ftp://x" })).toThrow(EmailConfigError);
  });
});

describe("renderReturnEmail", () => {
  const base = {
    customerName: "Ana",
    orderNumber: "ABCDEF12",
    failureReason: "recipient_absent",
    deadlineText: "lunes, 24 de noviembre, 3:40 p. m.",
    scheduledText: "sábado, 22 de noviembre",
    refundText: "$ 45.000",
    orderUrl: null,
    orderPath: "/orders/x",
  };
  it("customer: the reason, the three options and the deadline", () => {
    const email = renderReturnEmail({ ...base, template: "delivery_customer" });
    expect(email.subject).toBe("No pudimos entregar tu pedido ABCDEF12");
    expect(email.text).toContain("no había nadie para recibir el pedido");
    expect(email.text).toContain("Recogerlo en la tienda");
    expect(email.text).toContain("sin pagar otra vez el domicilio");
    expect(email.text).toContain("El domicilio no se devuelve");
    expect(email.text).toContain("lunes, 24 de noviembre, 3:40 p. m. (hora de Colombia)");
    expect(email.text).toContain("/orders/x");
  });
  it("force majeure: the new day, no cost", () => {
    const email = renderReturnEmail({ ...base, template: "delivery_force_majeure", failureReason: "vehicle_breakdown" });
    expect(email.text).toContain("el vehículo del mensajero se averió");
    expect(email.text).toContain("sábado, 22 de noviembre, sin costo adicional");
  });
  it("underage: the amount of the products", () => {
    const email = renderReturnEmail({ ...base, template: "delivery_underage", failureReason: "recipient_underage" });
    expect(email.text).toContain("Te devolveremos $ 45.000, el valor de los productos");
  });
  it("escapes the customer's name in the HTML", () => {
    const email = renderReturnEmail({ ...base, template: "delivery_customer", customerName: "<b>x</b>" });
    expect(email.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(email.html).not.toContain("<b>x</b>");
  });
});

describe("sendOrderEmail (worker)", () => {
  it("sends to the customer with the order link", async () => {
    const send = vi.fn(async () => ({ messageId: "m-1" }));
    const result = await sendOrderEmail(
      { template: "delivery_customer", order_id: DATA.order_id },
      { loadData: async () => DATA, send, config: CONFIG },
    );
    expect(result).toEqual({ sent: true, messageId: "m-1" });
    const [message] = send.mock.calls[0] as unknown as [{ to: string; subject: string; text: string; html: string }];
    expect(message.to).toBe("cliente@test.local");
    expect(message.subject).toBe("No pudimos entregar tu pedido ABCDEF12");
    expect(message.text).toContain(`http://localhost:3000/orders/${DATA.order_id}`);
    expect(message.html).toContain("Ana &lt;Pérez&gt;");
  });

  it("fails at once for a bad payload, a missing order or no email", async () => {
    const send = vi.fn();
    await expect(sendOrderEmail({ template: "spam", order_id: "x" }, { send, config: CONFIG })).rejects.toBeInstanceOf(PermanentActionError);
    await expect(
      sendOrderEmail({ template: "delivery_customer", order_id: "x" }, { loadData: async () => null, send, config: CONFIG }),
    ).rejects.toBeInstanceOf(PermanentActionError);
    await expect(
      sendOrderEmail({ template: "delivery_customer", order_id: "x" }, { loadData: async () => ({ ...DATA, email: null }), send, config: CONFIG }),
    ).rejects.toBeInstanceOf(PermanentActionError);
    expect(send).not.toHaveBeenCalled();
  });

  it("an SMTP error is not permanent, so the queue retries", async () => {
    const send = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const error = await sendOrderEmail(
      { template: "delivery_underage", order_id: DATA.order_id },
      { loadData: async () => DATA, send, config: CONFIG },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentActionError);
  });
});
