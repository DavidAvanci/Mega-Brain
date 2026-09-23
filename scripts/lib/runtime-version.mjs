/**
 * Runtime directories are immutable, so their identity must change whenever
 * the embedded backend changes. Keeping the package version in the prefix
 * remains useful for diagnostics while the digest prevents rebuild collisions.
 */
export function contentAddressedRuntimeVersion(baseVersion, sha256) {
  const base = String(baseVersion || '0.1.0').trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(base)) {
    throw new Error(`Versão base inválida para o runtime: ${base}`)
  }
  if (!/^[0-9a-f]{64}$/i.test(sha256)) {
    throw new Error('SHA-256 inválido para o runtime.')
  }
  return `${base.slice(0, 51)}-${sha256.slice(0, 12).toLowerCase()}`
}
