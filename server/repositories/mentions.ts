import { activeRepositories, activeRepositoryPath, repositoryCatalogFile } from './catalog'
import type { Repository, RepositoryMention } from '../../shared/domain/repositories'

export function repositoryMentions(repositories: Repository[]): RepositoryMention[] {
  const active = repositories.filter(repo => repo.active)
  const mentions = active.map(({ id, alias, displayName }) => ({ id, alias, displayName }))
  const aliases = new Set(mentions.map(item => item.alias.toLowerCase()))
  for (const repo of active) for (const tag of repo.tags ?? []) {
    const alias = /^workspace:([a-z0-9][a-z0-9._-]{0,62})$/.exec(tag)?.[1]
    if (!alias || aliases.has(alias)) continue
    aliases.add(alias)
    mentions.push({ id: `workspace:${alias}`, alias, displayName: `Workspace · ${alias}` })
  }
  return mentions
}

export interface ResolvedRepositoryMention {
  id: string
  alias: string
  path: string
}

/** Resolve only currently active aliases. Unknown @words remain ordinary text. */
export function resolveRepositoryMentions(text: string, settingsFile?: string): ResolvedRepositoryMention[] {
  if (!text.includes('@')) return []
  const file = repositoryCatalogFile(settingsFile)
  const repositories = activeRepositories(file)
  const byAlias = new Map(repositories.map((repository) => [repository.alias.toLowerCase(), repository]))
  const resolved = new Map<string, ResolvedRepositoryMention>()
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_.@-])@([a-z0-9][a-z0-9._-]{0,62})/giu)) {
    if (match[2].toLowerCase() === 'nota' && /^\[(page|folder):/.test(text.slice(match.index! + match[0].length)))
      continue
    let alias = match[2].toLowerCase()
    let repository = byAlias.get(alias)
    const workspaceRepos = (name: string) => repositories.filter(repo => repo.tags?.includes(`workspace:${name}`))
    // Sentence punctuation may follow a mention.
    while (!repository && !workspaceRepos(alias).length && /[.-]$/.test(alias)) {
      alias = alias.slice(0, -1)
      repository = byAlias.get(alias)
    }
    for (const repo of repository ? [repository] : workspaceRepos(alias)) {
      if (resolved.has(repo.id)) continue
      resolved.set(repo.id, { id: repo.id, alias: repo.alias, path: activeRepositoryPath(repo.alias, file) })
    }
  }
  return [...resolved.values()]
}

export function repositoryMentionContext(text: string, settingsFile?: string): string {
  const repositories = resolveRepositoryMentions(text, settingsFile)
  if (!repositories.length) return text
  return `${text}\n\nRepositórios mencionados (identidades verificadas no catálogo ativo):\n${repositories.map(({ id, alias, path }) => `- ${JSON.stringify({ id, alias, path })}`).join('\n')}\nWorkspaces agrupam repositórios independentes. Planeje alterações em todos os repositórios necessários; use uma seção ## <alias> por repositório no TASK-CHECKLIST.md e deps entre itens para coordenar mudanças. Execute instalação, Git e testes dentro de cada checkout, com seu próprio gerenciador de pacotes.`
}
