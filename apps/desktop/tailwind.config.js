/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "brand-navy": "#0F1A2E",
        "brand-navy-2": "#16233D",
        "brand-teal": "#0E8074",
        "brand-green": "#3FBF8F"
      }
    }
  },
  plugins: []
};
