import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Same scope `next lint` had (the application code); tests, scripts, database files and generated output are not linted here.
export default [
  ...nextCoreWebVitals,
  {
    // eslint-plugin-react-hooks 7 (bundled with eslint-config-next 16) adds rules that only matter to the React Compiler, which this app does not use.
    // They did not exist in the toolchain this code was written and tested against, and they flag deliberate, covered patterns (the study/practice
    // controllers read refs from callbacks, effects reset local state). `rules-of-hooks` and `exhaustive-deps` stay on exactly as before.
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
    },
  },
  { ignores: [".next/**", "node_modules/**", "reports/**", "tests/**", "scripts/**", "database/**", "docs/**", "docker/**", "public/**", "next-env.d.ts", "*.config.*"] },
];
