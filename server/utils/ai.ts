const DEFAULT_AI_TIMEOUT_MS = 60000
const MIN_AI_TIMEOUT_MS = 5000
const MAX_AI_TIMEOUT_MS = 180000

export function getAiTimeoutMs(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_AI_TIMEOUT_MS
  return Math.max(MIN_AI_TIMEOUT_MS, Math.min(MAX_AI_TIMEOUT_MS, Math.round(parsed)))
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
