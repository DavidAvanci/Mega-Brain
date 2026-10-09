import { createHash } from 'node:crypto'
import { BoundedCache } from '../../shared/lib/bounded-cache'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeBin, codexBin } from '../agent-executable'
import type { ProcessOwner, ProcessRunner } from '../process'
import type { MegaBrainConfig } from '../config'
import { DEFAULT_PROMPTS } from '../../shared/domain/settings'
import { cardRepos } from './worktree-inspector'

type Review = { schemaVersion: 2; sections: unknown[]; noise: unknown[] }
type DiffDocument = { schemaVersion: 1; generatedAt: string; repositories: { name: string; review: Review }[] }
type DiffState = {
  status: 'running' | 'error' | 'ready'
  result?: DiffDocument
  error?: string
  steps?: string[]
  started: boolean
}

const LEGACY_SKILL_INTRO =
  'Esta skill faz só o que não pode ser determinístico, e o script `review.mjs` (na pasta desta skill; o diretório base vem no prompt de invocação, senão `~/.claude/skills/smart-diff-review/`) valida e monta o resultado.'
const REVIEW_INTRO =
  'O agente faz as decisões que não podem ser determinísticas. O script de revisão incluído no Mega Brain valida e monta o resultado.'

function readDocument(cardPath: string): DiffDocument | undefined {
  try {
    const value = JSON.parse(readFileSync(join(cardPath, 'diff.json'), 'utf8')) as DiffDocument
    if (value.schemaVersion === 1 && Array.isArray(value.repositories)) return value
  } catch {
    /* No completed review yet. */
  }
  return undefined
}

function validatedReview(path: string): Review {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Review
  if (value.schemaVersion !== 2 || !Array.isArray(value.sections) || !Array.isArray(value.noise))
    throw new Error('O agente não produziu uma revisão Smart Diff válida')
  if (
    value.sections.some(
      (section) => !section || typeof section !== 'object' || !Array.isArray((section as { files?: unknown }).files),
    )
  )
    throw new Error('O agente produziu seções de revisão inválidas')
  return value
}

function exec(runner: ProcessRunner, command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    runner.execFile(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout)
    })
  })
}

async function githubDefaultBranch(runner: ProcessRunner, repoPath: string): Promise<string> {
  const branch = (
    await exec(runner, 'gh', ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], repoPath)
  ).trim()
  if (!branch) throw new Error('O GitHub não informou a branch padrão do repositório')
  return branch
}

export function reviewPrompt(
  cardPath: string,
  jobs: { name: string; baseBranch: string; report: string; output: string; cache: string }[],
  instructions: string,
  reviewScript: string,
): string {
  return [
    instructions
      .replaceAll(LEGACY_SKILL_INTRO, REVIEW_INTRO)
      .replaceAll('<script-de-revisao>', reviewScript)
      .replaceAll('<dir-da-skill>/review.mjs', reviewScript),
    'Os relatórios já foram gerados contra a branch padrão remota de cada repositório. Não execute o Smart Diff novamente.',
    'Para cada relatório, rode prepare, leia todos os patches, escreva as decisões em decisions.json e rode assemble até validar.',
    'Use o cache indicado. Não edite o JSON final à mão. Trabalhe somente nos arquivos dentro da pasta do card.',
    `Pasta do card: ${cardPath}`,
    ...jobs.map(
      (job) =>
        `Repositório ${job.name} (base origin/${job.baseBranch}): report=${job.report}; saída=${job.output}; cache=${job.cache}; trabalho=${resolve(job.output, '..')}`,
    ),
  ].join('\n')
}

export function createSmartDiffReview(config: MegaBrainConfig, runner: ProcessRunner, owner?: ProcessOwner) {
  const states = new Map<string, DiffState>()
  const errors = new BoundedCache<string, DiffState>(100)

  function step(cardPath: string, message: string): void {
    const current = states.get(cardPath)
    if (current?.status === 'running') states.set(cardPath, { ...current, steps: [...(current.steps ?? []), message] })
  }

  async function generate(cardPath: string): Promise<void> {
    step(cardPath, 'Identificando repositórios do card')
    const repos = cardRepos(cardPath)
    const work = join(cardPath, '.smart-diff-review')
    mkdirSync(work, { recursive: true })
    const smartDiff = join(
      process.env.SMART_DIFF_DIR || join(homedir(), 'smart-diff'),
      'packages/cli/bin/smart-diff.cjs',
    )
    const reviewScript = join(dirname(fileURLToPath(import.meta.url)), 'smart-diff-review-cli.mjs')
    if (repos.length && !existsSync(smartDiff)) throw new Error(`Smart Diff não encontrado: ${smartDiff}`)
    const jobs = []
    for (const repo of repos) {
      step(cardPath, `Rodando a ferramenta Smart Diff em ${repo.name}`)
      const baseBranch = await githubDefaultBranch(runner, repo.path)
      await exec(
        runner,
        config.executables.git || 'git',
        ['fetch', '--no-tags', 'origin', `refs/heads/${baseBranch}`],
        repo.path,
      )
      const dir = join(work, createHash('sha256').update(repo.name).digest('hex').slice(0, 16))
      mkdirSync(dir, { recursive: true })
      const report = join(dir, 'report.json')
      const output = join(dir, 'review.json')
      const cache = join(dir, 'cache.json')
      rmSync(output, { force: true })
      const result = await exec(
        runner,
        process.execPath,
        [smartDiff, '--range', 'FETCH_HEAD...HEAD', '--format', 'json'],
        repo.path,
      )
      const parsed = JSON.parse(result) as { schemaVersion?: number; readingOrder?: unknown[] }
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.readingOrder))
        throw new Error(`Smart Diff retornou um relatório inválido para ${repo.name}`)
      writeFileSync(report, result)
      jobs.push({ name: repo.name, baseBranch, report, output, cache })
    }
    if (jobs.length) {
      step(cardPath, 'Rodando o agente de revisão')
      const prompt = reviewPrompt(
        cardPath,
        jobs,
        config.preferences.prompts?.smartDiffReview || DEFAULT_PROMPTS.smartDiffReview,
        reviewScript,
      )
      const codex = config.preferences.llmProvider === 'chatgpt'
      const command = codex ? codexBin(config.executables.codex) : claudeBin(config.executables.claude)
      const args = codex
        ? ['exec', '--dangerously-bypass-approvals-and-sandbox', prompt]
        : ['-p', prompt, '--dangerously-skip-permissions']
      const out = openSync(join(work, 'agent.log'), 'w')
      const err = openSync(join(work, 'agent-error.log'), 'w')
      try {
        await new Promise<void>((resolve, reject) => {
          const child = runner.spawn(command, args, { cwd: cardPath, stdio: ['ignore', out, err] })
          owner?.own(child, { label: 'smart-diff-review' })
          child.once('error', reject)
          child.once('close', (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`Agente de revisão terminou com código ${code ?? 'desconhecido'}`)),
          )
        })
      } finally {
        closeSync(out)
        closeSync(err)
      }
    }
    step(cardPath, 'Validando e salvando a revisão')
    const document: DiffDocument = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      repositories: jobs.map((job) => ({ name: job.name, review: validatedReview(job.output) })),
    }
    const temporary = join(cardPath, 'diff.json.tmp')
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`)
    renameSync(temporary, join(cardPath, 'diff.json'))
    // The completed document is already persisted. Do not retain all its patches.
    states.delete(cardPath)
  }

  return {
    isRunning(cardPath: string): boolean {
      return states.get(cardPath)?.status === 'running'
    },
    read(cardPath: string): DiffState {
      const current = states.get(cardPath) ?? errors.get(cardPath)
      if (current) return current
      const result = readDocument(cardPath)
      if (result) return { status: 'ready', result, started: true }
      if (existsSync(join(cardPath, '.smart-diff-review', 'started.json')))
        return {
          status: 'error',
          error: 'A revisão anterior foi interrompida. Gere um novo Smart Diff para tentar novamente.',
          started: true,
        }
      return { status: 'error', error: 'O diff ainda não foi gerado', started: false }
    },
    start(cardPath: string, regenerate = false): DiffState {
      const current = this.read(cardPath)
      if (current.status === 'running' || (current.started && !regenerate)) return current
      const work = join(cardPath, '.smart-diff-review')
      mkdirSync(work, { recursive: true })
      writeFileSync(join(work, 'started.json'), `${JSON.stringify({ startedAt: new Date().toISOString() })}\n`)
      const running: DiffState = { status: 'running', steps: ['Iniciando revisão Smart Diff'], started: true }
      states.set(cardPath, running)
      errors.delete(cardPath)
      void generate(cardPath).catch((error: unknown) => {
        const latest = states.get(cardPath)
        states.delete(cardPath)
        errors.set(cardPath, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          steps: latest?.steps,
          started: true,
        })
      })
      return running
    },
  }
}
