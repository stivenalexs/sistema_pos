// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

describe("test setup", () => {
  it("renders a React component in jsdom", () => {
    render(<p>Listo</p>);
    expect(screen.getByText("Listo")).toBeDefined();
  });
});
