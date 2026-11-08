// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdempotentActionForm } from "./idempotent-action-form";
import type { IdempotentFormState } from "./idempotent-form-state";

function keyOf(container: HTMLElement) {
  return (container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement).value;
}

describe("IdempotentActionForm", () => {
  afterEach(cleanup);

  it("renders the fields and fills the idempotency key in the browser", () => {
    const { container } = render(
      <IdempotentActionForm
        action={async (s) => s}
        hidden={{ productId: "p1" }}
        fields={[
          { kind: "select", name: "productId2", label: "Producto", options: [{ value: "a", label: "A" }] },
          { kind: "number", name: "units", label: "Unidades", min: 1, max: 100 },
          { kind: "text", name: "reason", label: "Motivo" },
          { kind: "text", name: "note", label: "Nota", required: false },
        ]}
        submitLabel="Registrar"
      />,
    );
    expect(keyOf(container)).toMatch(/^[0-9a-f-]{36}$/);
    expect(container.querySelector('input[name="productId"]')?.getAttribute("value")).toBe("p1");
    const units = screen.getByLabelText("Unidades");
    expect(units.getAttribute("min")).toBe("1");
    expect(units.getAttribute("max")).toBe("100");
    expect(screen.getByLabelText("Motivo").getAttribute("minlength")).toBe("3");
    expect(screen.getByLabelText("Nota").hasAttribute("required")).toBe(false);
  });

  it("sends the same key until the server answers, then a new one", async () => {
    const keys: string[] = [];
    let answer = 0;
    const action = vi.fn(async (_s: IdempotentFormState, data: FormData): Promise<IdempotentFormState> => {
      keys.push(String(data.get("idempotencyKey")));
      answer += 1;
      return { status: "ok", message: "Listo", answer };
    });
    const { container } = render(
      <IdempotentActionForm action={action} fields={[{ kind: "text", name: "reason", label: "Motivo" }]} submitLabel="Registrar" />,
    );
    const first = keyOf(container);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Conteo" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(keys[0]).toBe(first);
    expect(await screen.findByText("Listo")).toBeTruthy();
    expect(keyOf(container)).not.toBe(first);
  });

  it("keeps what was typed when the server rejects the form", async () => {
    const action = async (_s: IdempotentFormState, data: FormData): Promise<IdempotentFormState> => ({
      status: "error",
      message: "No hay tantas unidades",
      values: { reason: String(data.get("reason")) },
      answer: 1,
    });
    const { container } = render(
      <IdempotentActionForm action={action} fields={[{ kind: "text", name: "reason", label: "Motivo" }]} submitLabel="Registrar" />,
    );
    const first = keyOf(container);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Rotura grande" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(await screen.findByText("No hay tantas unidades")).toBeTruthy();
    expect((screen.getByLabelText("Motivo") as HTMLInputElement).value).toBe("Rotura grande");
    // A rejection ends the intention too: the next submit is a new one.
    expect(keyOf(container)).not.toBe(first);
  });
});
