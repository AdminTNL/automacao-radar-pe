export const OFFLINE_MESSAGE = 'Sem conexão com o servidor.'

interface SupabaseErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
}

export function isOfflineError(error: SupabaseErrorLike | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'BACKEND_UNREACHABLE') return true
  if (error.code) return false
  const text = `${error.message ?? ''} ${error.details ?? ''}`
  return /fetch failed|failed to fetch|TypeError|NetworkError|error code:\s*\d{4}|1016|1033|530|1101|Worker threw exception|bad gateway|service unavailable|connection (refused|reset|timed out)/i.test(
    text,
  )
}

export function errorMessage(error: SupabaseErrorLike | null | undefined): string {
  if (isOfflineError(error)) return OFFLINE_MESSAGE
  return error?.message || 'Erro inesperado.'
}
