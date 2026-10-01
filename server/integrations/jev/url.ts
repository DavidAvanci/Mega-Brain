export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai'

/** API origin only; the API path is fixed by the backend. */
export function normalizeJevBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('URL do API TypeSafe inválida')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Informe somente a origem HTTPS do API TypeSafe, sem caminho ou credenciais')
  return url.origin
}
