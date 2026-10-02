import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./tests/fixtures/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#09090B", surface: "#111113", raised: "#18181B", line: "#27272A",
        ink: "#FAFAFA", sub: "#A1A1AA",
        // mute: smallest metadata text. #71717A measured 3.67-4.12:1 on our surfaces (WCAG AA needs 4.5). #9898A1 is >= 4.5 on bg, surface, raised and the lime/violet tints.
        mute: "#9898A1",
        lime: { DEFAULT: "#B8FF3D", dim: "#B8FF3D1f" },
        // violet stays #8B5CF6 for borders, tints and icons; TEXT uses violet-fg (#8B5CF6 text is 4.08-4.70:1, below AA on cards and tints).
        violet: { DEFAULT: "#8B5CF6", fg: "#A78BFA" },
      },
      fontFamily: { sans: ["var(--font-inter)", "system-ui", "sans-serif"] },
      borderRadius: { card: "20px", ctl: "14px" },
      transitionDuration: { DEFAULT: "180ms" },
    },
  },
  plugins: [],
};
export default config;
