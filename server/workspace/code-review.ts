import { createHash } from 'node:crypto'
import { BoundedCache } from '../../shared/lib/bounded-cache'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeBin, codexBin } from '../agent-executable'
import { agentNarration, parseJsonRecord, readTail } from '../agent-log'
import type { AgentInfo } from '../../shared/domain/agents'
import type { ProcessOwner, ProcessRunner } from '../process'
import type { MegaBrainConfig } from '../config'
import { DEFAULT_PROMPTS } from '../../shared/domain/settings'
import { cardRepos, worktreeRepoInfo } from './worktree-inspector'
import { readStageSettings } from './stage-settings'
import { agentModelArgs } from '../agent-model-args'

type Review = {
  schemaVersion: 2
  findings: {
    severity: string
    title: string
    file: string
    line: number
    evidence: string
    impact: string
    recommendation: string
  }[]
}
type DiffDocument = {
  schemaVersion: 1
  generatedAt: string
  repositories: { name: string; review: Review }[]
}
type ReviewState = {
  status: 'running' | 'error' | 'ready'
  result?: DiffDocument
  error?: string
  steps?: string[]
  activity?: AgentInfo
  started: boolean
}

function readDocument(cardPath: string): DiffDocument | undefined {
  try {
    const value = JSON.parse(readFileSync(join(cardPath, 'diff.json'), 'utf8')) as DiffDocument
    if (
      value.schemaVersion === 1 &&
      Array.isArray(value.repositories) &&
      value.repositories.every(
        (repo) => repo && typeof repo === 'object' && Array.isArray((repo as { review?: Review }).review?.findings),
      )
    )
      return value
  } catch {
    /* No completed review yet. */
  }
  return undefined
}

function validatedReview(path: string): Review {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Review
  if (value.schemaVersion !== 2 || !Array.isArray(value.findings))
    throw new Error('O agente não produziu um relatório de revisão válido')
  if (value.findings.some((finding) => !finding || typeof finding !== 'object' || typeof finding.title !== 'string'))
    throw new Error('O agente produziu achados de revisão inválidos')
  return value
}

export function codeReviewPrompt(
  cardPath: string,
  jobs: { name: string; path: string; baseRef?: string; baseHash?: string; output: string }[],
  instructions: string,
): string {
  return [
    instructions,
    'Revise diretamente o diff Git de cada repositório listado abaixo contra a base informada. Se não houver hash da base, localize a branch base remota com git e calcule o merge-base com HEAD. Inspecione também os arquivos completos relevantes e as instruções locais do projeto. Não use ferramentas externas de análise de diff e não execute testes.',
    'Grave em cada caminho de saída um JSON válido, sem cercas Markdown, no formato {"schemaVersion":2,"findings":[{"severity":"Crítico|Alto|Médio|Baixo","title":"resumo acionável","file":"caminho relativo ao repositório","line":1,"evidence":"evidência concreta","impact":"consequência","recommendation":"correção sugerida"}]}. Se não houver achados, use findings vazio.',
    'Inclua somente defeitos concretos sustentados pelo código. Não altere arquivos dos repositórios, checklist ou Base de conhecimento.',
    `Pasta do card: ${cardPath}`,
    ...jobs.map(
      (job) =>
        `Repositório ${job.name}: diretório=${job.path}; base=${job.baseRef ?? 'detectar branch base'}; hashBase=${job.baseHash ?? 'não informado'}; relatório=${job.output}`,
    ),
  ].join('\n')
}

export function createCodeReview(
  config: MegaBrainConfig,
  runner: ProcessRunner,
  owner?: ProcessOwner,
  onComplete?: (cardPath: string) => void,
) {
  const states = new Map<string, ReviewState>()
  const errors = new BoundedCache<string, ReviewState>(100)

  function step(cardPath: string, message: string, provider?: AgentInfo['provider']): void {
    const current = states.get(cardPath)
    if (current?.status === 'running')
      states.set(cardPath, {
        ...current,
        steps: [...(current.steps ?? []), message],
        activity: {
          status: 'rodando',
          stage: 'code-review',
          execution: 'agent',
          provider,
          phase: message,
        },
      })
  }

  function activity(cardPath: string): AgentInfo | undefined {
    const current = states.get(cardPath)
    if (current?.status !== 'running') return undefined
    const log = join(cardPath, '.code-review', 'agent.log')
    if (!existsSync(log)) return current.activity
    const latest = { ...current.activity! }
    for (const line of readTail(log, 128 * 1024).split('\n')) {
      const event = parseJsonRecord(line)
      if (!event) continue
      if (typeof event.session_id === 'string') latest.sessionId = event.session_id
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') latest.sessionId = event.thread_id
      const narration = agentNarration(event)
      if (narration) latest.activity = narration
    }
    current.activity = latest
    return latest
  }

  async function generate(cardPath: string): Promise<void> {
    const repos = cardRepos(cardPath)
    const work = join(cardPath, '.code-review')
    mkdirSync(work, { recursive: true })
    const jobs = repos.map((repo) => {
      const info = worktreeRepoInfo(repo, config.executables.git, runner)
      const output = join(work, `${createHash('sha256').update(repo.name).digest('hex').slice(0, 16)}.json`)
      return { name: repo.name, path: repo.path, baseRef: info.base?.ref, baseHash: info.base?.hash, output }
    })
    if (jobs.length) {
      const codex = config.preferences.llmProvider === 'chatgpt'
      step(cardPath, 'Executando o agente Revisor', codex ? 'codex' : 'claude')
      const prompt = codeReviewPrompt(
        cardPath,
        jobs,
        config.preferences.prompts?.codeReview || DEFAULT_PROMPTS.codeReview,
      )
      const command = codex ? codexBin(config.executables.codex) : claudeBin(config.executables.claude)
      const settings = readStageSettings(config.workspaceDir, config.preferences.llmProvider)['code-review']
      const modelArgs = agentModelArgs(config.preferences.llmProvider, settings)
      const args = codex
        ? ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', ...modelArgs, prompt]
        : ['-p', prompt, ...modelArgs, '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose']
      const out = openSync(join(work, 'agent.log'), 'w')
      const err = openSync(join(work, 'agent-error.log'), 'w')
      try {
        await new Promise<void>((resolve, reject) => {
          const child = runner.spawn(command, args, { cwd: cardPath, stdio: ['ignore', out, err] })
          owner?.own(child, { label: 'code-review' })
          child.once('error', reject)
          child.once('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`Agente Revisor terminou com código ${code ?? 'desconhecido'}`)),
          )
        })
      } finally {
        closeSync(out)
        closeSync(err)
      }
    }
    step(cardPath, 'Salvando o relatório de revisão')
    const document: DiffDocument = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      repositories: jobs.map((job) => ({ name: job.name, review: validatedReview(job.output) })),
    }
    const temporary = join(cardPath, 'diff.json.tmp')
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`)
    renameSync(temporary, join(cardPath, 'diff.json'))
    onComplete?.(cardPath)
    states.delete(cardPath)
  }

  return {
    activity,
    read(cardPath: string): ReviewState {
      const current = states.get(cardPath) ?? errors.get(cardPath)
      if (current) return current.status === 'running' ? { ...current, activity: activity(cardPath) } : current
      const result = readDocument(cardPath)
      if (result) return { status: 'ready', result, started: true }
      if (existsSync(join(cardPath, '.code-review', 'started.json')))
        return { status: 'error', error: 'A revisão anterior foi interrompida. Execute o Revisor novamente.', started: true }
      return { status: 'error', error: 'A revisão ainda não foi gerada', started: false }
    },
    start(cardPath: string, regenerate = false): ReviewState {
      const current = this.read(cardPath)
      if (current.status === 'running' || (current.started && !regenerate)) return current
      const work = join(cardPath, '.code-review')
      mkdirSync(work, { recursive: true })
      writeFileSync(join(work, 'started.json'), `${JSON.stringify({ startedAt: new Date().toISOString() })}\n`)
      const running: ReviewState = {
        status: 'running',
        steps: ['Iniciando revisão de código'],
        activity: { status: 'rodando', stage: 'code-review', execution: 'agent', phase: 'Iniciando revisão de código' },
        started: true,
      }
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
