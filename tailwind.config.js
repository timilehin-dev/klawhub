/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        darkBg: "#07090e",
        glassPanel: "rgba(17, 24, 39, 0.65)",
        glassBorder: "rgba(255, 255, 255, 0.08)",
        sleekCyan: "#00E5FF",
        neonPurple: "#7C4DFF",
        glowGreen: "#00E676"
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))"
      }
    }
  },
  plugins: []
}
