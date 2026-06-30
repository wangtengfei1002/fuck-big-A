export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@pinia/nuxt', '@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    aiBaseUrl: process.env.AI_BASE_URL,
    aiApiKey: process.env.AI_API_KEY,
    aiModel: process.env.AI_MODEL,
    aiTimeoutMs: process.env.AI_TIMEOUT_MS,
    pushplusToken: process.env.PUSHPLUS_TOKEN,
    public: {
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL
    }
  },
  app: {
    head: {
      title: 'A-Share Auto Trader',
      meta: [
        {
          name: 'description',
          content: 'A Nuxt 4 front-end stock simulation dashboard for A-shares and retail ETF trading.'
        }
      ]
    }
  },
  future: {
    compatibilityVersion: 4
  },
  typescript: {
    strict: true
  }
})
