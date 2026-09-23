import { runClaudeItem } from './executor.ts'
import { currentBranch, git, hasRef } from './git.ts'

const AGENT_TIMEOUT_MS = 15 * 60_000

function clean(cwd: string): boolean {
  return !git(cwd, 'status', '--porcelain')
}

/**
 * Git pauses a multi-commit cherry-pick when a commit's patch is already in
 * the target branch, and again after rerere replays a known resolution. In
 * neither state is there a conflict left to resolve: advancing the sequencer
 * is deterministic and avoids spending an agent.
 */
export function advanceCherryPick(cwd: string): { complete: boolean; skipped: number } {
  let skipped = 0
  while (hasRef(cwd, 'CHERRY_PICK_HEAD')) {
    const unmerged = git(cwd, 'diff', '--name-only', '--diff-filter=U')
    const unstaged = git(cwd, 'diff', '--name-only')
    if (unmerged || unstaged) return { complete: false, skipped }
    if (git(cwd, 'diff', '--cached', '--name-only')) {
      const before = git(cwd, 'rev-parse', 'HEAD')
      try {
        git(cwd, '-c', 'core.editor=true', 'cherry-pick', '--continue')
      } catch {
        // `--continue` exits non-zero when the next commit of the sequence
        // conflicts. Only a sequencer that did not move means the agent is needed.
        if (git(cwd, 'rev-parse', 'HEAD') === before) return { complete: false, skipped }
      }
      continue
    }
    skipped++
    try {
      git(cwd, 'cherry-pick', '--skip')
    } catch {
      // `--skip` may immediately reach the next conflicting/empty commit in
      // the sequence. Inspect that new state before deciding whether an agent
      // is actually necessary.
      if (!hasRef(cwd, 'CHERRY_PICK_HEAD')) throw new Error('Git falhou ao avançar o cherry-pick vazio')
    }
  }
  return { complete: true, skipped }
}

function prompt(repo: string, operation: 'cherry-pick' | 'rebase', base: string, branch: string): string {
  const action =
    operation === 'cherry-pick'
      ? 'Há um cherry-pick em conflito já iniciado.'
      : `Há um rebase em conflito da branch ${branch} sobre origin/${base}.`
  const finish =
    operation === 'cherry-pick'
      ? 'Conclua o cherry-pick com `git cherry-pick --continue`.'
      : 'Conclua o rebase com `git rebase --continue`.'
  return [
    `Resolva o conflito Git no repositório ${repo}. ${action}`,
    'Trabalhe somente nos arquivos que fazem parte do conflito e preserve as duas intenções quando forem compatíveis.',
    'Inspecione os marcadores de conflito e o histórico antes de editar. Rode a validação mais específica e viável para os arquivos alterados.',
    `${finish} Não use --no-verify, não use git reset/checkout para descartar trabalho, não use git cherry-pick --abort/--skip nem git rebase --abort/--skip.`,
    'Não faça push, não crie PR e não altere arquivos sem relação com o conflito.',
    'Se a resolução exigir uma decisão de produto ou você não conseguir validar, pare sem inventar uma solução e retorne status blocked.',
  ].join('\n')
}

export async function resolveCherryPickConflict(
  cwd: string,
  repo: string,
  baseRef: string,
  expectedCommits: number,
): Promise<void> {
  const empty = advanceCherryPick(cwd)
  if (empty.complete) {
    assertAllCommitsApplied(cwd, repo, baseRef, expectedCommits - empty.skipped)
    return
  }
  const result = await runClaudeItem({
    cwd,
    prompt: prompt(repo, 'cherry-pick', 'staging', currentBranch(cwd)),
    model: process.env.CHECKLIST_MODEL ?? 'sonnet',
    effort: process.env.CHECKLIST_EFFORT ?? 'medium',
    tools: 'Bash,Read,Edit,Write',
    maxTurns: 20,
    timeoutMs: AGENT_TIMEOUT_MS,
  })
  if (result.status !== 'done') throw new Error(`${repo}: agente não resolveu o conflito de staging: ${result.note}`)
  advanceCherryPick(cwd)
  if (hasRef(cwd, 'CHERRY_PICK_HEAD')) throw new Error(`${repo}: agente terminou, mas o cherry-pick continua pendente`)
  if (!clean(cwd)) throw new Error(`${repo}: agente terminou com alterações não commitadas`)
  assertAllCommitsApplied(cwd, repo, baseRef, expectedCommits - empty.skipped)
}

function assertAllCommitsApplied(cwd: string, repo: string, baseRef: string, expected: number): void {
  const applied = Number(git(cwd, 'rev-list', '--count', `${baseRef}..HEAD`))
  if (applied < expected)
    throw new Error(`${repo}: o cherry-pick não contém todos os commits esperados (${applied}/${expected})`)
}

export async function resolveRebaseConflict(cwd: string, repo: string, base: string, branch: string): Promise<void> {
  const result = await runClaudeItem({
    cwd,
    prompt: prompt(repo, 'rebase', base, branch),
    model: process.env.CHECKLIST_MODEL ?? 'sonnet',
    effort: process.env.CHECKLIST_EFFORT ?? 'medium',
    tools: 'Bash,Read,Edit,Write',
    maxTurns: 20,
    timeoutMs: AGENT_TIMEOUT_MS,
  })
  if (result.status !== 'done') throw new Error(`${repo}: agente não resolveu o conflito de master: ${result.note}`)
  if (!clean(cwd)) throw new Error(`${repo}: agente terminou com alterações não commitadas`)
  if (currentBranch(cwd) !== branch) throw new Error(`${repo}: agente terminou fora da branch ${branch}`)
}
