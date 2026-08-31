// Brand config sourced from Vite env vars. Defaults are the AI TRED AGENT brand.
// See docs/WHITE_LABEL.md for the remix workflow.
export const BRAND = {
  name: import.meta.env.VITE_BRAND_NAME ?? "AI TRED AGENT",
  tagline: import.meta.env.VITE_BRAND_TAGLINE ?? "Automated Crypto Signal Trading",
  logoInitial: import.meta.env.VITE_BRAND_LOGO_INITIAL ?? "A",
  adminInitial: import.meta.env.VITE_BRAND_ADMIN_INITIAL ?? "A",
  footerName: import.meta.env.VITE_BRAND_FOOTER_NAME ?? "AI TRED AGENT",
};
