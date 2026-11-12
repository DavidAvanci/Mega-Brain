import type { DefaultBranchDirtyFile } from './agents'

export function parseDirtyFileSummary(status: string): DefaultBranchDirtyFile[] {
  const entries = status.split('\0').filter(Boolean)
  const summary: DefaultBranchDirtyFile[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const code = entry.slice(0, 2)
    const kinds = new Set(code.split(''))
    const change =
      code === '??' || kinds.has('A')
        ? 'novo'
        : kinds.has('D')
          ? 'excluído'
          : kinds.has('R')
            ? 'renomeado'
            : kinds.has('C')
              ? 'copiado'
              : kinds.has('U')
                ? 'conflito'
                : 'modificado'
    summary.push({ path: entry.slice(3), change })
    if (kinds.has('R') || kinds.has('C')) index++
  }
  return summary
}
