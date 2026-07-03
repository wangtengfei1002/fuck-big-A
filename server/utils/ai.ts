const DEFAULT_AI_TIMEOUT_MS = 60000
const MIN_AI_TIMEOUT_MS = 5000
const MAX_AI_TIMEOUT_MS = 180000
const OPENAI_OFFICIAL_HOST = 'api.openai.com'
const DEFAULT_OPUS_BASE_URL = 'https://aixj.vip/v1'
const DEFAULT_OPUS_MODEL = 'opus4.8'
const DEFAULT_PRIMARY_MODEL = 'gpt-5.5'
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'

export interface AiChatProvider {
  name: 'Opus' | 'OpenAI' | 'DeepSeek'
  baseUrl: string
  apiKey: string
  model: string
}

interface AiRuntimeConfig {
  opusBaseUrl?: unknown
  opusApiKey?: unknown
  opusModel?: unknown
  aiBaseUrl?: unknown
  aiApiKey?: unknown
  aiModel?: unknown
  deepseekBaseUrl?: unknown
  deepseekApiKey?: unknown
  deepseekModel?: unknown
}

export function getAiTimeoutMs(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_AI_TIMEOUT_MS
  return Math.max(MIN_AI_TIMEOUT_MS, Math.min(MAX_AI_TIMEOUT_MS, Math.round(parsed)))
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export function getAiProviders(config: AiRuntimeConfig): AiChatProvider[] {
  const providers: AiChatProvider[] = []
  const opusApiKey = optionalString(config.opusApiKey)
  const aiBaseUrl = optionalString(config.aiBaseUrl)
  const aiApiKey = optionalString(config.aiApiKey)
  const aiModel = optionalString(config.aiModel) || DEFAULT_PRIMARY_MODEL
  const deepseekApiKey = optionalString(config.deepseekApiKey)

  if (opusApiKey) {
    providers.push({
      name: 'Opus',
      baseUrl: optionalString(config.opusBaseUrl) || DEFAULT_OPUS_BASE_URL,
      apiKey: opusApiKey,
      model: optionalString(config.opusModel) || DEFAULT_OPUS_MODEL
    })
  }

  if (aiBaseUrl && aiApiKey) {
    providers.push({
      name: 'OpenAI',
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      model: aiModel
    })
  }

  if (deepseekApiKey) {
    providers.push({
      name: 'DeepSeek',
      baseUrl: optionalString(config.deepseekBaseUrl) || DEFAULT_DEEPSEEK_BASE_URL,
      apiKey: deepseekApiKey,
      model: optionalString(config.deepseekModel) || DEFAULT_DEEPSEEK_MODEL
    })
  }

  return providers
}

export function aiProviderModelLabel(provider: AiChatProvider) {
  return provider.name === 'OpenAI' ? provider.model : `${provider.name} ${provider.model}`
}

export function aiProviderChatCompletionUrl(provider: AiChatProvider) {
  return `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`
}

export function aiProviderHeaders(provider: AiChatProvider) {
  return {
    Authorization: `Bearer ${provider.apiKey}`,
    'Content-Type': 'application/json'
  }
}

export async function withAiProviderFallback<T>(
  providers: AiChatProvider[],
  attempt: (provider: AiChatProvider) => Promise<T>
) {
  let lastError: unknown

  for (const provider of providers) {
    try {
      return {
        provider,
        value: await attempt(provider)
      }
    } catch (error) {
      lastError = error
      console.warn(`[ai] ${provider.name} ${provider.model} failed, trying next provider`, getErrorMessage(error, 'unknown error'))
    }
  }

  throw lastError ?? new Error('No AI provider is available.')
}

function shouldStripOpenAiExtras(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host !== OPENAI_OFFICIAL_HOST
  } catch {
    return true
  }
}

function toCompatibleBody(body: Record<string, unknown>) {
  const { reasoning_effort: _reasoningEffort, store: _store, ...compatibleBody } = body
  return compatibleBody
}

export async function requestChatCompletion<T>(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeout: number
) {
  const firstBody = shouldStripOpenAiExtras(url) ? toCompatibleBody(body) : body

  try {
    return await $fetch<T>(url, {
      method: 'POST',
      headers,
      body: firstBody,
      timeout
    })
  } catch (error) {
    const message = getErrorMessage(error, '')
    const canRetryWithoutOpenAiExtras = firstBody === body
      && /reasoning_effort|store|unsupported|unrecognized|unknown|invalid/i.test(message)
    if (!canRetryWithoutOpenAiExtras) throw error

    return await $fetch<T>(url, {
      method: 'POST',
      headers,
      body: toCompatibleBody(body),
      timeout
    })
  }
}
