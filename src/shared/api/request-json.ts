import { ApiError, apiClient } from './api-client'

export async function requestJson<T>(
  path: string,
  fallback: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  try {
    return await apiClient().json<T>(path, options)
  } catch (error) {
    if (error instanceof ApiError && error.message === `Request failed (HTTP ${error.status})`) {
      throw new Error(`${fallback} (HTTP ${error.status})`)
    }
    if (error instanceof TypeError && /failed to fetch|load failed|networkerror/i.test(error.message)) {
      throw new Error(
        `${fallback}: não foi possível conectar ao backend. Verifique a conexão do Mega Brain e tente novamente.`,
        { cause: error },
      )
    }
    throw error
  }
}
