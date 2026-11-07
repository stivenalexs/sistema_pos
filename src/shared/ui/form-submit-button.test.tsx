// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormSubmitButton } from "./form-submit-button";

afterEach(cleanup);

describe("FormSubmitButton", () => {
  it("submits only once on a fast double click", async () => {
    let finish!: () => void;
    const action = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <form action={action}>
        <FormSubmitButton>Entrar</FormSubmitButton>
      </form>,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await screen.findByText("Procesando…");
    expect(action).toHaveBeenCalledTimes(1);
    expect(button).toHaveProperty("disabled", true);

    await act(async () => finish());
    await screen.findByText("Entrar");
    expect(button).toHaveProperty("disabled", false);
  });

  it("does not lock when the form is invalid", () => {
    const action = vi.fn();
    render(
      <form action={action}>
        <input name="email" required />
        <FormSubmitButton>Entrar</FormSubmitButton>
      </form>,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveProperty("disabled", false);
  });
});
