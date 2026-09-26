/** Gateway origin only; the API path is fixed by the backend. */
export function normalizeLayaBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('URL do gateway Laya inválida')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Informe somente a origem HTTP(S) do gateway Laya, sem caminho ou credenciais')
  return url.origin
}
