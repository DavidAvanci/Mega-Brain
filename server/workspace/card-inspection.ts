import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessRunner } from '../process'
import { CARD_FILES } from './card-artifacts'
import { readCard } from './card-record'
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
) {
  const stored = readCard(card.path, card.name)
  return {
    files: Object.fromEntries(
      CARD_FILES.map((file) => [
        file,
        existsSync(join(card.path, file)) ? readFileSync(join(card.path, file), 'utf8') : null,
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
