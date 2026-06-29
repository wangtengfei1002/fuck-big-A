import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  content: [
    './app/components/**/*.{vue,js,ts}',
    './app/layouts/**/*.vue',
    './app/pages/**/*.vue',
    './app/app.vue'
  ],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        panel: '#f8fafc',
        line: '#d6dde7',
        rise: '#dc2626',
        fall: '#16a34a',
        amber: '#d97706',
        ocean: '#0f766e'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        grid: '0 1px 0 rgba(17, 24, 39, 0.08)'
      }
    }
  }
}
