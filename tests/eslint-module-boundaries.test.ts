import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Verifies the agents.md section 3 rule: modules talk to each other only
// through their public index.ts.
const eslint = new ESLint({ cwd: process.cwd() });

async function boundaryErrors(code: string, file: string): Promise<number> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(process.cwd(), file),
  });
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === "no-restricted-imports",
  ).length;
}

const ORDERS_FILE = "src/modules/orders/server/create-order.ts";

// ESLint starts cold in the first test (5+ s when the whole suite runs in parallel).
describe("module boundaries", { timeout: 20_000 }, () => {
  it("allows importing another module through its public index", async () => {
    expect(
      await boundaryErrors('export * from "@/modules/pricing";\n', ORDERS_FILE),
    ).toBe(0);
  });

  it("allows relative imports inside the same module", async () => {
    expect(
      await boundaryErrors('export * from "../domain/order";\n', ORDERS_FILE),
    ).toBe(0);
  });

  it("blocks alias imports of another module's internals", async () => {
    expect(
      await boundaryErrors(
        'export * from "@/modules/pricing/server/get-price";\n',
        ORDERS_FILE,
      ),
    ).toBe(1);
  });

  it("blocks relative imports of another module's internals", async () => {
    expect(
      await boundaryErrors(
        'export * from "../../pricing/domain/price";\n',
        ORDERS_FILE,
      ),
    ).toBe(1);
  });

  it("allows the browser-safe API of another module (D-077)", async () => {
    expect(
      await boundaryErrors('export * from "@/modules/pricing/client";\n', ORDERS_FILE),
    ).toBe(0);
    expect(
      await boundaryErrors('export * from "@/modules/pricing/clientele";\n', ORDERS_FILE),
    ).toBe(1);
  });

  it("client.ts exports only pure rules and Client Components (D-077)", async () => {
    const CLIENT = "src/modules/orders/client.ts";
    expect(await boundaryErrors('export * from "./domain/pickup";\n', CLIENT)).toBe(0);
    expect(await boundaryErrors('export { X } from "./ui/x";\n', CLIENT)).toBe(0);
    expect(await boundaryErrors('export { getOrder } from "./server/orders";\n', CLIENT)).toBe(1);
    expect(await boundaryErrors('export * from "@/shared/supabase/server";\n', CLIENT)).toBe(1);
  });

  it("blocks reaching into modules from outside src/modules", async () => {
    expect(
      await boundaryErrors(
        'export * from "../modules/pricing/server/get-price";\n',
        "src/app/page.tsx",
      ),
    ).toBe(1);
  });
});
