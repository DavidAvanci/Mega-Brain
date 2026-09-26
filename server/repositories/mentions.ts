import { activeRepositories, activeRepositoryPath, repositoryCatalogFile } from './catalog'

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
    let alias = match[2].toLowerCase()
    let repository = byAlias.get(alias)
    // Sentence punctuation may follow a mention.
    while (!repository && /[.-]$/.test(alias)) {
      alias = alias.slice(0, -1)
      repository = byAlias.get(alias)
    }
    if (!repository || resolved.has(repository.id)) continue
    resolved.set(repository.id, {
      id: repository.id,
      alias: repository.alias,
      path: activeRepositoryPath(repository.alias, file),
    })
  }
  return [...resolved.values()]
}

export function repositoryMentionContext(text: string, settingsFile?: string): string {
  const repositories = resolveRepositoryMentions(text, settingsFile)
  if (!repositories.length) return text
  return `${text}\n\nRepositórios mencionados (identidades verificadas no catálogo ativo):\n${repositories.map(({ id, alias, path }) => `- ${JSON.stringify({ id, alias, path })}`).join('\n')}`
}
