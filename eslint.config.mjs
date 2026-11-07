import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// agents.md section 3: a module may only import another module through its
// public index.ts (`@/modules/<module>`), never its internal files.
const MODULE_BOUNDARY_MESSAGE =
  "Importa otro módulo solo por su index.ts público (`@/modules/<modulo>`), no sus archivos internos (agents.md, sección 3).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@/modules/[^/]+/.+",
              message: MODULE_BOUNDARY_MESSAGE,
            },
            {
              regex: "^(\\.\\./)+modules/",
              message: MODULE_BOUNDARY_MESSAGE,
            },
            {
              regex: "^(\\.\\./){2,}[a-z-]+/(domain|server|ui)(/|$)",
              message: MODULE_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
  ]),
]);

export default eslintConfig;
