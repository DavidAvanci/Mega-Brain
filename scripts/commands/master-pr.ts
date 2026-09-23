import { nextDeploySlot } from '../../shared/lib/deploy-window.ts'
import {
  countCommits,
  currentBranch,
  defaultBranch,
  existingPrUrl,
  featureBranch,
  gh,
  git,
  hasRef,
} from '../lib/git.ts'
import { runsAsCommand } from '../lib/env.ts'
import { jiraEnv, prsCommentAdf, textCommentAdf, transitionTo, upsertComment } from '../lib/jira.ts'
import { activity, finish } from '../lib/log.ts'
import { planSection, readPlan } from '../lib/plan.ts'
import { mergeCardPrs, repoLinks, taskInfo } from '../lib/workspace.ts'
import { resolveRebaseConflict } from '../lib/conflictResolver.ts'

const wsPath = process.argv[2] ?? process.cwd()
const draft = process.argv.includes('--draft')
const baseOverrides = parseBaseOverrides(process.argv)

function parseBaseOverrides(argv: string[]): Record<string, string> {
  const overrides: Record<string, string> = {}
  argv.forEach((arg, i) => {
    if (arg !== '--base') return
    const [repo, branch] = (argv[i + 1] ?? '').split('=')
    if (!repo || !branch) throw new Error('--base espera <repo>=<branch>')
    overrides[repo] = branch
  })
  return overrides
}

function prHasConflicts(cwd: string, url: string): boolean {
  try {
    const state = gh(
      cwd,
      'pr',
      'view',
      url,
      '--json',
      'mergeable,mergeStateStatus',
      '--jq',
      '[.mergeable, .mergeStateStatus] | join(" ")',
    )
    return state.includes('CONFLICTING') || state.includes('DIRTY')
  } catch {
    return false
  }
}

async function masterPr(
  repo: { name: string; path: string },
  task: ReturnType<typeof taskInfo>,
  body: string,
): Promise<string> {
  const cwd = repo.path
  const base = baseOverrides[repo.name] ?? defaultBranch(cwd)
  const checkedOut = currentBranch(cwd)
  if (checkedOut === base || checkedOut === 'HEAD')
    throw new Error(`${repo.name}: worktree está em ${checkedOut}, não numa feature branch`)
  const branch = featureBranch(cwd, repo.name)
  if (git(cwd, 'status', '--porcelain')) throw new Error(`${repo.name}: há alterações não commitadas`)
  git(cwd, 'fetch', 'origin')
  const ahead = countCommits(cwd, `origin/${base}..${branch}`)
  if (!ahead) throw new Error(`${repo.name}: nenhum commit além de origin/${base}`)
  if (base !== 'staging' && hasRef(cwd, 'refs/remotes/origin/staging')) {
    const own = countCommits(cwd, `origin/${base}..${branch}`, '--not', 'origin/staging')
    if (own < ahead) {
      throw new Error(
        `${repo.name}: ${branch} carrega ${ahead - own} commits que já estão em origin/staging — um PR para ${base} traria commits de outras tasks`,
      )
    }
  }
  git(cwd, 'push', '-u', 'origin', branch)
  const existing = existingPrUrl(cwd, branch, base)
  const url =
    existing ??
    (gh(
      cwd,
      'pr',
      'create',
      '--base',
      base,
      '--head',
      branch,
      '--title',
      `[${task.id}] ${task.title}`.slice(0, 90),
      '--body',
      body,
      ...(draft ? ['--draft'] : []),
    )
      .split('\n')
      .findLast((line) => line.startsWith('https://')) as string)

  if (!prHasConflicts(cwd, url)) return url

  activity('Resolvendo conflito', `${repo.name} (master)`)
  try {
    git(cwd, 'rebase', `origin/${base}`)
  } catch (error) {
    try {
      await resolveRebaseConflict(cwd, repo.name, base, branch)
    } catch (resolutionError) {
      try {
        git(cwd, 'rebase', '--abort')
      } catch {}
      throw new Error(
        `${repo.name}: conflito no PR para ${base}. ${resolutionError instanceof Error ? resolutionError.message : resolutionError} (${error instanceof Error ? error.message : error})`,
      )
    }
  }
  git(cwd, 'push', '-u', 'origin', branch, '--force-with-lease')
  if (prHasConflicts(cwd, url))
    throw new Error(`${repo.name}: o PR para ${base} continua com conflitos após a resolução automática`)
  return url
}

export async function runMasterPrStage(): Promise<void> {
  const task = taskInfo(wsPath)
  const plan = readPlan(wsPath)
  const repos = repoLinks(wsPath)
  if (!repos.length) {
    finish(false, 'Nenhum repo (symlink) encontrado no workspace')
    process.exit(1)
  }

  const done = planSection(plan.raw, /o que foi feito/i)
  const body = [
    done ? `## O que foi feito\n${done}` : 'Alterações da task (ver commits).',
    task.jiraKey ? `Jira: https://takeat.atlassian.net/browse/${task.jiraKey}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const prs: Record<string, string> = {}
  const errors: string[] = []
  for (const repo of repos) {
    activity('Master PR', repo.name)
    try {
      prs[repo.name] = await masterPr(repo, task, body)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  const slot = nextDeploySlot()
  if (Object.keys(prs).length) {
    mergeCardPrs(wsPath, 'master', prs)
    const env = jiraEnv()
    if (task.jiraKey && env) {
      activity('Jira', `Comentando PRs em ${task.jiraKey}`)
      const sections: [string, string][] = done ? [['O que foi feito', done]] : []
      await upsertComment(env, task.jiraKey, 'PRs Master', prsCommentAdf('PRs Master', prs, sections))
      try {
        if (slot.open) {
          await transitionTo(env, task.jiraKey, 'STAGING')
        } else {
          await transitionTo(env, task.jiraKey, 'AGUARDANDO DEPLOY')
          await upsertComment(
            env,
            task.jiraKey,
            'Fora da janela de deploy.',
            textCommentAdf(`Fora da janela de deploy. Deploy previsto: ${slot.label} (BRT).`),
          )
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const ok = errors.length === 0 && Object.keys(prs).length === repos.length
  finish(
    ok,
    [
      `PRs: ${Object.values(prs).join(' ')}`,
      slot.open ? 'Dentro da janela de deploy' : `Deploy previsto: ${slot.label} (BRT)`,
      ...errors,
    ].join('\n'),
  )
  process.exit(ok ? 0 : 1)
}

if (runsAsCommand(import.meta.url)) {
  void runMasterPrStage().catch((error) => {
    finish(false, error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
