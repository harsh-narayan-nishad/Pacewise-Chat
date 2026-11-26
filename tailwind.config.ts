import type { Config } from "tailwindcss";

// Same design tokens as the main Pacewise app (colors, type scale, fonts) so To-do looks like part of it.
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'PP Neue Montreal'", "'Inter'", "'Söhne'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Roobert'", "'Inter'", "'Söhne'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'PP Neue Montreal Mono'", "'JetBrains Mono'", "'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      fontSize: {
        xs: ["12px", { lineHeight: "16px", letterSpacing: "0.02em" }],
        sm: ["14px", { lineHeight: "20px", letterSpacing: "0" }],
        base: ["16px", { lineHeight: "24px", letterSpacing: "0.01em" }],
        lg: ["18px", { lineHeight: "26px", letterSpacing: "0.005em" }],
        xl: ["20px", { lineHeight: "26px", letterSpacing: "-0.01em" }],
        "2xl": ["24px", { lineHeight: "30px", letterSpacing: "-0.01em" }],
        "3xl": ["32px", { lineHeight: "37px", letterSpacing: "-0.025em" }],
      },
      colors: {
        canvas: { DEFAULT: "rgb(var(--canvas) / <alpha-value>)", raised: "rgb(var(--canvas-raised) / <alpha-value>)" },
        ink: { DEFAULT: "rgb(var(--ink) / <alpha-value>)", muted: "rgb(var(--ink-muted) / <alpha-value>)", faint: "rgb(var(--ink-faint) / <alpha-value>)" },
        overlay: "rgb(var(--overlay) / <alpha-value>)",
        // Semantic colours (theme-aware, see globals.css). The older accent names point at them, so every use follows.
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        accent: { slow: "rgb(var(--info) / <alpha-value>)", medium: "rgb(var(--success) / <alpha-value>)", fast: "rgb(var(--warning) / <alpha-value>)", extreme: "rgb(var(--danger) / <alpha-value>)" },
        // Chat: the green, read ticks, and the two bubble colours (theme-aware, see globals.css).
        brand: "rgb(var(--brand) / <alpha-value>)",
        tick: "rgb(var(--tick-read) / <alpha-value>)",
        bubble: { out: "rgb(var(--bubble-out) / <alpha-value>)", in: "rgb(var(--bubble-in) / <alpha-value>)" },
      },
      boxShadow: { themed: "0 8px 30px -6px rgb(var(--shadow-color) / 0.35)" },
    },
  },
  plugins: [],
};
export default config;
