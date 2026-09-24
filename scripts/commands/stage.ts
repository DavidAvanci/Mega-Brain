import {
  currentBranch,
  defaultBranch,
  existingPrUrl,
  featureBranch,
  gh,
  git,
  hasRef,
  restoreBranch,
  stagingBranchOf,
} from '../lib/git.ts'
import { runsAsCommand } from '../lib/env.ts'
import { jiraEnv, jiraIssueUrl, jiraSiteForRepositories, prsCommentAdf, transitionTo, upsertComment } from '../lib/jira.ts'
import { activity, finish } from '../lib/log.ts'
import { planSection, readPlan } from '../lib/plan.ts'
import { mergeCardPrs, repoLinks, taskInfo } from '../lib/workspace.ts'
import { resolveCherryPickConflict } from '../lib/conflictResolver.ts'

const wsPath = process.argv[2] ?? process.cwd()
const draft = process.argv.includes('--draft')

function prBody(planRaw: string, jiraKey?: string, jiraSite?: string): string {
  const done = planSection(planRaw, /o que foi feito/i)
  const before = planSection(planRaw, /o que acontecia/i)
  const parts = [
    before ? `## O que acontecia\n${before}` : '',
    done ? `## O que foi feito\n${done}` : '',
    jiraKey && jiraIssueUrl(jiraKey, jiraSite) ? `Jira: ${jiraIssueUrl(jiraKey, jiraSite)}` : '',
  ].filter(Boolean)
  return parts.join('\n\n') || 'Alterações da task (ver commits).'
}

async function stageRepo(
  repo: { name: string; path: string },
  task: ReturnType<typeof taskInfo>,
  body: string,
): Promise<string> {
  const cwd = repo.path
  const base = defaultBranch(cwd)
  const checkedOut = currentBranch(cwd)
  if (checkedOut === base || checkedOut === 'HEAD')
    throw new Error(`${repo.name}: worktree está em ${checkedOut}, não numa feature branch`)
  const branch = featureBranch(cwd, repo.name)

  // A branch de staging é descartável, então desfazer um cherry-pick interrompido nela não perde trabalho.
  if (checkedOut === stagingBranchOf(branch) && !restoreBranch(cwd, branch))
    throw new Error(`${repo.name}: não foi possível devolver a worktree de ${checkedOut} para ${branch}`)

  const dirty = git(cwd, 'status', '--porcelain')
  if (dirty) {
    const on = currentBranch(cwd)
    if (on !== branch) {
      throw new Error(
        `${repo.name}: há alterações não commitadas com a worktree em ${on} — volte para ${branch} e commite antes`,
      )
    }
    git(cwd, 'add', '-A')
    const args = ['commit', '-m', `chore: ajustes finais da task ${task.id}`]
    if (task.jiraKey) args.push('-m', `Refs: ${task.jiraKey}`)
    git(cwd, ...args)
  }

  git(cwd, 'fetch', 'origin')
  // `--no-merges`: staging recebe só o trabalho da branch. Um merge de master
  // não é cherry-pickável sem escolher mainline, e o que ele traz staging já tem.
  const commits = git(cwd, 'rev-list', '--reverse', '--no-merges', `origin/${base}..${branch}`)
    .split('\n')
    .filter(Boolean)
  if (!commits.length) throw new Error(`${repo.name}: nenhum commit em ${branch} além de origin/${base}`)
  git(cwd, 'push', '-u', 'origin', branch)

  const stagingBranch = stagingBranchOf(branch)
  // Sequencer órfão de uma execução interrompida encerra o novo cherry-pick no primeiro commit.
  git(cwd, 'cherry-pick', '--quit')
  git(cwd, 'checkout', '-B', stagingBranch, 'origin/staging')
  try {
    try {
      git(cwd, '-c', 'rerere.enabled=true', '-c', 'rerere.autoUpdate=true', 'cherry-pick', ...commits)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (!hasRef(cwd, 'CHERRY_PICK_HEAD'))
        throw new Error(`${repo.name}: falha ao aplicar commits em staging sem conflito Git. (${detail})`)
      activity('Resolvendo conflito', repo.name)
      try {
        await resolveCherryPickConflict(cwd, repo.name, 'origin/staging', commits.length)
      } catch (resolutionError) {
        throw new Error(
          `${repo.name}: conflito no cherry-pick para staging. ${resolutionError instanceof Error ? resolutionError.message : resolutionError} (${detail})`,
        )
      }
    }
    git(cwd, 'push', '-u', 'origin', stagingBranch, '--force-with-lease')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!restoreBranch(cwd, branch))
      throw new Error(`${message} — worktree ficou em ${currentBranch(cwd)}, limpe antes de repetir`)
    throw error
  }
  git(cwd, 'checkout', branch)

  const existing = existingPrUrl(cwd, stagingBranch, 'staging')
  if (existing) return existing

  return gh(
    cwd,
    'pr',
    'create',
    '--base',
    'staging',
    '--head',
    stagingBranch,
    '--title',
    `[${task.id}] ${task.title}`.slice(0, 90),
    '--body',
    body,
    ...(draft ? ['--draft'] : []),
  )
    .split('\n')
    .findLast((line) => line.startsWith('https://')) as string
}

export async function runStagingStage(): Promise<void> {
  const task = taskInfo(wsPath)
  const plan = readPlan(wsPath)
  const repos = repoLinks(wsPath)
  if (!repos.length) {
    finish(false, 'Nenhum repo (symlink) encontrado no workspace')
    process.exit(1)
  }

  const jiraSite = jiraSiteForRepositories(repos.map((repo) => repo.name))
  const body = prBody(plan.raw, task.jiraKey, jiraSite)
  const prs: Record<string, string> = {}
  const errors: string[] = []
  for (const repo of repos) {
    activity('Staging PR', repo.name)
    try {
      prs[repo.name] = await stageRepo(repo, task, body)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (Object.keys(prs).length) {
    mergeCardPrs(wsPath, 'staging', prs)
    const env = jiraEnv(jiraSite)
    if (task.jiraKey && env) {
      activity('Jira', `Comentando PRs em ${task.jiraKey}`)
      const sections: [string, string][] = []
      const before = planSection(plan.raw, /o que acontecia/i)
      const done = planSection(plan.raw, /o que foi feito/i)
      if (before) sections.push(['O que acontecia', before])
      if (done) sections.push(['O que foi feito', done])
      await upsertComment(env, task.jiraKey, 'PRs Staging', prsCommentAdf('PRs Staging', prs, sections))
      try {
        await transitionTo(env, task.jiraKey, 'CODE REVIEW')
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const ok = errors.length === 0 && Object.keys(prs).length === repos.length
  finish(ok, [`PRs: ${Object.values(prs).join(' ')}`, ...errors].join('\n'))
  process.exit(ok ? 0 : 1)
}

if (runsAsCommand(import.meta.url)) {
  void runStagingStage().catch((error) => {
    finish(false, error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
