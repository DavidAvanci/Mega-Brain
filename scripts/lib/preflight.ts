import type { Item } from './checklist.ts'

export interface PreflightIssue {
  level: 'error' | 'warn'
  where: string
  message: string
}

export interface PreflightDeps {
  repoExists: (repo: string) => boolean
  pathExists: (repo: string, pattern: string) => boolean
}

function findCycle(items: Item[]): string[] | null {
  const byId = new Map(items.map((item) => [item.id, item]))
  const state = new Map<string, 'open' | 'closed'>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'closed') return null
    if (state.get(id) === 'open') return [...stack.slice(stack.indexOf(id)), id]
    state.set(id, 'open')
    stack.push(id)
    for (const dep of byId.get(id)?.deps ?? []) {
      if (dep === id || !byId.has(dep)) continue
      const cycle = visit(dep)
      if (cycle) return cycle
    }
    stack.pop()
    state.set(id, 'closed')
    return null
  }
  for (const item of items) {
    const cycle = visit(item.id)
    if (cycle) return cycle
  }
  return null
}

export function preflight(items: Item[], deps: PreflightDeps): PreflightIssue[] {
  if (!items.length) {
    return [{ level: 'error', where: 'checklist', message: 'Nenhum item executável (seções descartadas não contam)' }]
  }
  const issues: PreflightIssue[] = []
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.explicitId) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  }
  for (const [id, count] of counts) {
    if (count > 1) issues.push({ level: 'error', where: id, message: `Id repetido em ${count} itens` })
  }

  const ids = new Set(items.map((item) => item.id))
  const repos = new Set<string>()
  for (const item of items) {
    if (item.repo) repos.add(item.repo)
    else
      issues.push({ level: 'error', where: item.id, message: 'Sem repo — falta um heading `## <repo>` antes do item' })
    for (const dep of item.deps) {
      if (dep === item.id) issues.push({ level: 'error', where: item.id, message: 'Depende de si mesmo' })
      else if (!ids.has(dep))
        issues.push({ level: 'error', where: item.id, message: `deps: ${dep} não existe no checklist` })
    }
  }

  for (const repo of [...repos].sort()) {
    if (deps.repoExists(repo)) continue
    issues.push({
      level: 'error',
      where: `## ${repo}`,
      message: `Heading não resolve para um repositório ativo em Repositórios — corrija o nome ou marque a seção como descartada (\`## ~~${repo}~~\`)`,
    })
  }

  const cycle = findCycle(items)
  if (cycle) issues.push({ level: 'error', where: cycle[0], message: `Ciclo em deps: ${cycle.join(' → ')}` })

  for (const item of items) {
    if (!item.repo || !deps.repoExists(item.repo)) continue
    for (const pattern of item.requires) {
      if (deps.pathExists(item.repo, pattern)) continue
      issues.push({
        level: 'error',
        where: item.id,
        message: `requires: ${pattern} — requisito obrigatório não existe na base preparada`,
      })
    }
  }
  return issues
}
