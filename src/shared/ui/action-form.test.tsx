// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionForm } from "./action-form";
import type { ActionFormState } from "./action-form-state";

describe("ActionForm without idempotency (D-077)", () => {
  afterEach(cleanup);

  it("sends no idempotency key, and keeps what was typed after a rejection", async () => {
    const sent: FormData[] = [];
    const action = vi.fn(async (_s: ActionFormState, data: FormData): Promise<ActionFormState> => {
      sent.push(data);
      return { status: "error", message: "Revisa el valor.", values: { name: "Tarifa X" }, answer: 1 };
    });
    const { container } = render(
      <ActionForm action={action} fields={[{ kind: "text", name: "name", label: "Nombre" }]} submitLabel="Guardar" />,
    );
    expect(container.querySelector('input[name="idempotencyKey"]')).toBeNull();

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Tarifa X" } });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(sent[0]?.has("idempotencyKey")).toBe(false);
    expect(await screen.findByText("Revisa el valor.")).toBeTruthy();
    expect((screen.getByLabelText("Nombre") as HTMLInputElement).value).toBe("Tarifa X");
  });
});
