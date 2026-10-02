import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./tests/fixtures/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#09090B", surface: "#111113", raised: "#18181B", line: "#27272A",
        ink: "#FAFAFA", sub: "#A1A1AA", mute: "#71717A",
        lime: { DEFAULT: "#B8FF3D", dim: "#B8FF3D1f" },
        violet: { DEFAULT: "#8B5CF6" },
      },
      fontFamily: { sans: ["var(--font-inter)", "system-ui", "sans-serif"] },
      borderRadius: { card: "20px", ctl: "14px" },
      transitionDuration: { DEFAULT: "180ms" },
    },
  },
  plugins: [],
};
export default config;
