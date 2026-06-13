/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#f5f7ff', 100: '#ebf0ff', 200: '#d6e0ff', 300: '#b3c5ff',
          400: '#8ca3ff', 500: '#6b82ff', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        'soft-md': '0 4px 12px rgba(16,24,40,0.06), 0 2px 4px rgba(16,24,40,0.04)',
        'soft-lg': '0 12px 32px rgba(16,24,40,0.10), 0 4px 8px rgba(16,24,40,0.04)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
    },
  },
  plugins: [],
};