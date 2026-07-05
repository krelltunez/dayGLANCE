/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // dayGLANCE wordmark (Lora, self-hosted). Georgia/serif fallback
        // renders immediately while the woff2 loads (font-display: swap).
        brand: ['Lora', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      colors: {
        // dayGLANCE brand orange (the "GLANCE" in the wordmark).
        brand: '#fe8b00',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
