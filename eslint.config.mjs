import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Throwaway scenario harnesses (audit session) — not shipped code:
    "harness/**",
    "verify-*.mts",
  ]),
  // The first-load restore in page.tsx (share link / device cache / sample →
  // initial village) is a one-time external-data sync: it writes the initial
  // state exactly once, guarded by a ref, so the setStates are the rule's
  // legitimate use case rather than the cascading derived-state pattern it
  // guards against. The compiler-extension version of the rule doesn't honor
  // inline disable comments in this setup, so the exemption lives here.
  {
    files: ["src/app/page.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);

export default eslintConfig;
