import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// agents.md section 3: a module may only import another module through its
// public index.ts (`@/modules/<module>`), never its internal files. Client
// Components use its browser-safe API, `@/modules/<module>/client` (D-077).
const MODULE_BOUNDARY_MESSAGE =
  "Importa otro módulo solo por su index.ts público (`@/modules/<modulo>`) o su client.ts (`@/modules/<modulo>/client`), no sus archivos internos (agents.md, sección 3).";

// client.ts is what the browser may import: only pure rules (domain/) and
// Client Components (ui/), never server code (D-077).
const CLIENT_API_MESSAGE =
  "client.ts solo exporta reglas puras (./domain/) y componentes de navegador (./ui/), nunca código del servidor (D-077).";

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
              regex: "^@/modules/[^/]+/(?!client$).+",
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
  {
    files: ["src/modules/*/client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "^(?!\\./(domain|ui)/|\\./legal-copy$).*", message: CLIENT_API_MESSAGE },
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
