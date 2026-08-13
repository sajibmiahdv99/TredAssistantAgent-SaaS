// Brand config sourced from Vite env vars. Defaults match the current
// hardcoded strings so a deploy with no VITE_BRAND_* vars set is
// pixel-for-pixel identical to the original Hermes build.
// See docs/WHITE_LABEL.md for the remix workflow.
export const BRAND = {
  name: import.meta.env.VITE_BRAND_NAME ?? "Hermes",
  tagline: import.meta.env.VITE_BRAND_TAGLINE ?? "Workstation",
  logoInitial: import.meta.env.VITE_BRAND_LOGO_INITIAL ?? "H",
  adminInitial: import.meta.env.VITE_BRAND_ADMIN_INITIAL ?? "A",
  footerName: import.meta.env.VITE_BRAND_FOOTER_NAME ?? "Hermes Agent Workstation",
};
