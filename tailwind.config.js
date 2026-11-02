/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: '#F7F4F0',
        surface: '#FFFFFF',
        sand: '#F0EBE5',
        ink: '#302925',
        muted: '#84776D',
        cocoa: '#453A35',
        clay: '#B48E78',
        line: '#E5DDD5',
        pine: '#5C8069',
        brick: '#B35B54',
      },
      borderRadius: {
        card: '14px',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        serif: ['Georgia', '"Times New Roman"', 'serif'],
      },
    },
  },
  plugins: [],
};
