// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReasonActionForm } from "./reason-action-form";

describe("ReasonActionForm", () => {
  it("renders the hidden ids and required text fields of 3+ characters", () => {
    const { container } = render(
      <ReasonActionForm
        action={async () => ({ status: "ok" })}
        hidden={{ orderId: "abc" }}
        fields={[
          { name: "reference", label: "Referencia", maxLength: 120 },
          { name: "note", label: "Nota" },
        ]}
        submitLabel="Registrar reembolso"
      />,
    );
    expect(container.querySelector('input[type="hidden"][name="orderId"]')?.getAttribute("value")).toBe("abc");
    const reference = screen.getByLabelText("Referencia");
    expect(reference.hasAttribute("required")).toBe(true);
    expect(reference.getAttribute("minlength")).toBe("3");
    expect(reference.getAttribute("maxlength")).toBe("120");
    expect(screen.getByLabelText("Nota").getAttribute("maxlength")).toBe("300");
    expect(screen.getByRole("button", { name: "Registrar reembolso" })).toBeTruthy();
  });
});
