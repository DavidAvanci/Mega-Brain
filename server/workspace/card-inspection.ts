import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessRunner } from '../process'
import { CARD_FILES } from './card-artifacts'
import { readCard } from './card-record'
import { readAgentUsageDetails } from './agent-usage'
import { repoDiff, worktreeRepoInfo, cardRepos } from './worktree-inspector'
import { cardWorktreeRepos } from './worktree-lifecycle'

export interface CardFolderReference {
  name: string
  path: string
}

export function inspectCard(
  card: CardFolderReference,
  worktreesRoot: string,
  git: string | undefined,
  runner: ProcessRunner,
  section?: string,
  file?: string | null,
) {
  const stored = readCard(card.path, card.name)
  if (section === 'file') {
    if (!file || !CARD_FILES.includes(file as (typeof CARD_FILES)[number])) throw new Error('Arquivo de card inválido')
    return { file, content: existsSync(join(card.path, file)) ? readFileSync(join(card.path, file), 'utf8') : null }
  }
  if (section === 'repos')
    return {
      repos: cardWorktreeRepos(card.path, worktreesRoot).map((repo) =>
        worktreeRepoInfo(repo, git, runner, stored.worktrees?.[repo.name]),
      ),
    }
  if (section === 'usage') {
    const usage = readAgentUsageDetails(card.path)
    return { usage: usage.usage, usageBreakdown: usage.breakdown }
  }
  const usage = readAgentUsageDetails(card.path)
  return {
    usage: usage.usage,
    usageBreakdown: usage.breakdown,
    files: Object.fromEntries(
      CARD_FILES.map((cardFile) => [
        cardFile,
        existsSync(join(card.path, cardFile)) ? readFileSync(join(card.path, cardFile), 'utf8') : null,
      ]),
    ),
    repos: cardWorktreeRepos(card.path, worktreesRoot).map((repo) =>
      worktreeRepoInfo(repo, git, runner, stored.worktrees?.[repo.name]),
    ),
  }
}

export function inspectCardDiff(cardPath: string, git: string | undefined, runner: ProcessRunner) {
  return {
    repos: cardRepos(cardPath).map((repo) => {
      try {
        return { name: repo.name, diff: repoDiff(repo.path, git, runner) }
      } catch (error) {
        return { name: repo.name, diff: '', error: error instanceof Error ? error.message : String(error) }
      }
    }),
  }
}
