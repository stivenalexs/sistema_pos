// Emails to the customer after a failed delivery (D-059, D-068). Pure: the
// worker passes already formatted values. Spanish (Colombia), no tracking,
// no images. The legal notice of D-008 lives in legal-copy.ts and is not
// repeated here.

export const RETURN_EMAIL_TEMPLATES = ["delivery_customer", "delivery_force_majeure", "delivery_underage"] as const;
export type ReturnEmailTemplate = (typeof RETURN_EMAIL_TEMPLATES)[number];

export function isReturnEmailTemplate(value: unknown): value is ReturnEmailTemplate {
  return typeof value === "string" && (RETURN_EMAIL_TEMPLATES as readonly string[]).includes(value);
}

/** How the customer reads the courier's reason. */
export const CUSTOMER_FAILURE_REASONS: Record<string, string> = {
  recipient_absent: "no había nadie para recibir el pedido",
  inaccessible_location: "no fue posible llegar a la dirección",
  no_id_document: "quien recibía no presentó la cédula",
  refused: "no se quiso recibir el pedido",
  other: "no fue posible entregarlo",
  recipient_underage: "quien recibía es menor de edad o no lo pudo acreditar",
  courier_accident: "el mensajero tuvo un accidente",
  vehicle_breakdown: "el vehículo del mensajero se averió",
  weather_or_disaster: "el clima o una emergencia impidieron la entrega",
  other_force_majeure: "un imprevisto ajeno a ti impidió la entrega",
};

export type ReturnEmailInput = {
  template: ReturnEmailTemplate;
  customerName: string;
  /** Short order number shown to the customer. */
  orderNumber: string;
  failureReason: string | null;
  /** "lunes, 24 de noviembre, 3:40 p. m." (Colombia). */
  deadlineText: string | null;
  /** "martes, 25 de noviembre". */
  scheduledText: string | null;
  /** "$ 45.000". */
  refundText: string | null;
  /** Absolute link to the order, or null without APP_URL. */
  orderUrl: string | null;
  orderPath: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function renderReturnEmail(input: ReturnEmailInput): RenderedEmail {
  const reason = (input.failureReason && CUSTOMER_FAILURE_REASONS[input.failureReason]) ?? "no fue posible entregarlo";
  const where = input.orderUrl
    ? `Puedes verlo en ${input.orderUrl}`
    : `Inicia sesión en La Cava y abre la dirección ${input.orderPath} de la tienda web.`;

  let subject: string;
  let paragraphs: string[];
  switch (input.template) {
    case "delivery_customer":
      subject = `No pudimos entregar tu pedido ${input.orderNumber}`;
      paragraphs = [
        `Intentamos entregar tu pedido ${input.orderNumber}, pero ${reason}. El pedido volvió a la tienda.`,
        "Elige qué prefieres en la página del pedido:",
        "• Recogerlo en la tienda.",
        "• Recibirlo de nuevo al día siguiente, sin pagar otra vez el domicilio.",
        "• Pedir el reembolso del valor de los productos. El domicilio no se devuelve porque sí se intentó.",
        input.deadlineText
          ? `Tienes hasta el ${input.deadlineText} (hora de Colombia). Si no eliges, el pedido queda para recoger en la tienda.`
          : "Si no eliges en 3 días, el pedido queda para recoger en la tienda.",
        where,
      ];
      break;
    case "delivery_force_majeure":
      subject = `Reprogramamos la entrega de tu pedido ${input.orderNumber}`;
      paragraphs = [
        `No pudimos entregar hoy tu pedido ${input.orderNumber}: ${reason}. No es culpa tuya.`,
        input.scheduledText
          ? `Lo enviaremos de nuevo el ${input.scheduledText}, sin costo adicional.`
          : "Lo enviaremos de nuevo al día siguiente, sin costo adicional.",
        where,
      ];
      break;
    case "delivery_underage":
      subject = `No pudimos entregar tu pedido ${input.orderNumber}`;
      paragraphs = [
        `Intentamos entregar tu pedido ${input.orderNumber}, pero ${reason}. La ley prohíbe entregar bebidas alcohólicas a menores de edad, así que el pedido volvió a la tienda.`,
        input.refundText
          ? `Te devolveremos ${input.refundText}, el valor de los productos. El domicilio no se devuelve porque sí se intentó.`
          : "Te devolveremos el valor de los productos. El domicilio no se devuelve porque sí se intentó.",
        "Nos pondremos en contacto contigo para el reembolso.",
        where,
      ];
      break;
  }

  const greeting = `Hola, ${input.customerName}:`;
  const signature = "La Cava · Licores con historia";
  const text = [greeting, "", ...paragraphs.flatMap((p) => [p, ""]), signature].join("\n");
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...paragraphs.map((p) => {
      const escaped = escapeHtml(p);
      return input.orderUrl && p === where
        ? `<p>Puedes verlo en <a href="${escapeHtml(input.orderUrl)}">${escapeHtml(input.orderUrl)}</a></p>`
        : `<p>${escaped}</p>`;
    }),
    `<p>${escapeHtml(signature)}</p>`,
  ].join("\n");

  return { subject, text, html };
}
