// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useFieldErrors } from "./field-errors";

afterEach(cleanup);

function Form({ errors }: { errors?: Partial<Record<string, string>> }) {
  const { formRef, invalid, error } = useFieldErrors(errors);
  return (
    <form ref={formRef}>
      <label>
        Nombre
        <input name="name" {...invalid("name")} />
        {error("name")}
      </label>
      <label>
        Correo
        <input name="email" {...invalid("email")} />
        {error("email")}
      </label>
      <input type="checkbox" aria-label="Acepto" {...invalid("accept")} />
      {error("accept", { inLabel: false })}
    </form>
  );
}

describe("useFieldErrors", () => {
  it("adds nothing when there are no errors", () => {
    render(<Form />);
    const name = screen.getByRole("textbox", { name: "Nombre" });
    expect(name.hasAttribute("aria-invalid")).toBe(false);
    expect(name.hasAttribute("aria-describedby")).toBe(false);
  });

  it("marks the field, links its message and keeps the name clean", () => {
    render(<Form errors={{ email: "Escribe un correo válido." }} />);
    const email = screen.getByRole("textbox", { name: "Correo" });
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(email.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Escribe un correo válido.",
    );
    expect(screen.getByRole("textbox", { name: "Correo" })).toBe(email);
  });

  it("moves focus to the first invalid field", () => {
    render(<Form errors={{ email: "Escribe un correo.", accept: "Debes aceptar." }} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Correo" }));
  });

  it("leaves a message outside a label readable", () => {
    render(<Form errors={{ accept: "Debes aceptar." }} />);
    expect(screen.getByText("Debes aceptar.").hasAttribute("aria-hidden")).toBe(false);
    expect(screen.getByText("Debes aceptar.", { selector: "span" })).toBeTruthy();
  });
});
