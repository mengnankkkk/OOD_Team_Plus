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
  globalIgnores([
    ".next/**",
    "coverage/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "Anthropic_front/**",
    "ponytail/**",
    "ui-ux-pro-max-skill/**",
  ]),
]);
