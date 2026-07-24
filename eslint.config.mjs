import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["src/server/db/runtime-schema.ts"],
    rules: {
      "max-lines": "off",
    },
  },
  {
    files: ["src/migrated-pages/desktop/**/*.{ts,tsx}", "src/components/desktop/**/*.{ts,tsx}"],
    rules: {
      "max-lines": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}", "src/features/frontend-migration/**/*.{ts,tsx}", "src/features/workbench/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "max-lines": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/app/(workbench)/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "src/server/extensions/advisor/professional.ts",
      "src/server/extensions/analysis/service.ts",
      "src/server/extensions/query/plan-generator.ts",
      "src/server/extensions/simulation/candidate-generator.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "coverage/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "Anthropic_front/**",
    "frontend_src/**",
    "ponytail/**",
    "ui-ux-pro-max-skill/**",
  ]),
]);
