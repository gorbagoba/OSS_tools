/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0d0d0d',
        text: '#eee',
        textSecondary: '#999',
        primary: '#6c8',
        border: '#2a2a2a',
        input: '#1a1a1a',
      },
    },
  },
  plugins: [],
}
