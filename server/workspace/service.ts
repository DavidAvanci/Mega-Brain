import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDevEnv, startDevEnv, stopDevEnv } from '../../devEnv'
import { prStates } from '../../prStatus'
import type { AgentInfo, FlowLevel } from '../../src/types'
import type { MegaBrainConfig } from '../config'
import { createOwnedProcessRunner, nodeProcessRunner, type ProcessOwner, type ProcessRunner } from '../process'
import type { ProcessChild } from '../process'
import { resolveOptionalExecutable, wslDesktopCandidates } from '../platform'
import { editorExecutable, readGeneralSettings, writeGeneralSettings } from '../app-settings'
import { detectEditors } from '../editor-detection'
import { assertTestWorkspace } from '../test-safety'
import { createCard, DEFAULT_FLOW, readFlow } from './card-folder'
import { createWorkspacePathResolver } from './path'

interface CardData {
  title: string
  description: string
  status: string
  flow?: FlowLevel
  prs?: { staging?: Record<string, string>; master?: Record<string, string> }
  worktrees?: Record<string, WorktreeOrigin>
}

interface WorktreeOrigin {
  ref: string
  hash: string
  repository?: string
  createdAt?: string
}

function readPrEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function readPrs(value: unknown): CardData['prs'] {
  if (!value || typeof value !== 'object') return undefined
  const { staging, master } = value as Record<string, unknown>
  const prs = { staging: readPrEnv(staging), master: readPrEnv(master) }
  return prs.staging || prs.master ? prs : undefined
}

function readWorktrees(value: unknown): CardData['worktrees'] {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value).flatMap(([repo, raw]) => {
    if (!raw || typeof raw !== 'object') return []
    const { ref, hash, repository, createdAt } = raw as Record<string, unknown>
    if (typeof ref !== 'string' || !ref || typeof hash !== 'string' || !hash) return []
    return [[repo, {
      ref,
      hash,
      repository: typeof repository === 'string' ? repository : undefined,
      createdAt: typeof createdAt === 'string' ? createdAt : undefined,
    }] as const]
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function readCard(folderPath: string, name: string): CardData {
  let data: Partial<CardData> = {}
  const file = join(folderPath, 'card.json')
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {}
  }
  return {
    title: typeof data.title === 'string' && data.title ? data.title : name,
    description: typeof data.description === 'string' ? data.description : '',
    status: typeof data.status === 'string' && data.status ? data.status : 'a-fazer',
    flow: readFlow(data.flow),
    prs: readPrs(data.prs),
    worktrees: readWorktrees(data.worktrees),
  }
}

function writeCard(folderPath: string, card: CardData): void {
  writeFileSync(join(folderPath, 'card.json'), `${JSON.stringify(card, null, 2)}\n`)
}

const AGENT_FILE = 'agent.json'
const STREAM_TAIL_BYTES = 128 * 1024
const STAGE_SNAPSHOT_PREFIX = '.stage-snapshot-'

interface StageProgress {
  done: number
  total: number
  phase: string
}

export interface Stage {
  name: string
  status: string
  next?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  model?: string
  prompt?: (card: CardData) => string
  script?: string
  progress: (path: string, startedAt?: string, flow?: FlowLevel) => StageProgress
}

const TASK_CHECKLIST_SCOPE = [
  'Regra obrigatória para TASK-CHECKLIST.md: inclua somente ações de implementação.',
  'Não crie tasks de testes de qualquer tipo, criação ou alteração de arquivos de teste, validação, conferência, QA, smoke test, revisão visual, screenshots ou verificações manuais/automatizadas.',
  'Toda atividade de teste ou verificação pertence exclusivamente à TEST-CHECKLIST.md quando esse artefato fizer parte do fluxo; nos demais fluxos, apenas não a inclua na TASK-CHECKLIST.md.',
]

function planningPrompt(card: CardData): string {
  const task = `${card.title}${card.description ? `\n\n${card.description}` : ''}`
  const flow = readFlow(card.flow)
  if (flow === 'simples') {
    return [
      `/task-planning ${task}`,
      '',
      'Fluxo SIMPLES (obrigatório): gere somente TASK-CHECKLIST.md.',
      'Não crie nem altere PLAN.md ou TEST-CHECKLIST.md.',
      'A TASK-CHECKLIST.md deve ser autocontida e trazer em cada item todo o contexto necessário para a implementação.',
      ...TASK_CHECKLIST_SCOPE,
    ].join('\n')
  }
  if (flow === 'medio') {
    return [
      `/task-planning ${task}`,
      '',
      'Fluxo MÉDIO (obrigatório): gere somente PLAN.md e TASK-CHECKLIST.md.',
      'Não crie nem altere TEST-CHECKLIST.md.',
      ...TASK_CHECKLIST_SCOPE,
    ].join('\n')
  }
  return [`/task-planning ${task}`, '', ...TASK_CHECKLIST_SCOPE].join('\n')
}

export const STAGES: Stage[] = [
  {
    name: 'task-planning',
    status: 'planejando',
    next: 'revisao-de-plano',
    effort: 'high',
    prompt: planningPrompt,
    progress: planningProgress,
  },
  {
    name: 'run-task-checklist',
    status: 'desenvolvendo',
    next: 'auto-testing',
    script: 'scripts/dev-stage.ts',
    progress: checklistProgress('TASK-CHECKLIST.md'),
  },
  {
    name: 'run-test-checklist',
    status: 'auto-testing',
    next: 'code-review',
    script: 'scripts/test-stage.ts',
    progress: checklistProgress('TEST-CHECKLIST.md'),
  },
  {
    name: 'stage-task',
    status: 'staging',
    script: 'scripts/stage.ts',
    progress: () => ({ done: 0, total: 1, phase: 'Abrindo PRs de staging' }),
  },
  {
    name: 'master-pr-task',
    status: 'aguardando-deploy',
    script: 'scripts/master-pr.ts',
    progress: () => ({ done: 0, total: 1, phase: 'Abrindo PRs de master' }),
  },
]

interface StageSnapshot {
  files: Record<string, string | null>
  screenshotFiles?: string[]
}

function stageSnapshotFile(path: string, stage: Stage): string {
  return join(path, `${STAGE_SNAPSHOT_PREFIX}${stage.name}.json`)
}

function stageOwnedFiles(stage: Stage): string[] {
  if (stage.name === 'task-planning') return CARD_FILES
  if (stage.name === 'run-task-checklist') return ['TASK-CHECKLIST.md']
  if (stage.name === 'run-test-checklist') return ['TEST-CHECKLIST.md']
  return []
}

function relativeFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) files.push(relative(root, full))
    }
  }
  visit(root)
  return files
}

function captureStageSnapshot(path: string, stage: Stage): void {
  const snapshot: StageSnapshot = {
    files: Object.fromEntries(stageOwnedFiles(stage).map((file) => [
      file,
      existsSync(join(path, file)) ? readFileSync(join(path, file), 'utf8') : null,
    ])),
    screenshotFiles: stage.name === 'run-test-checklist' ? relativeFiles(join(path, 'screenshots')) : undefined,
  }
  writeFileSync(stageSnapshotFile(path, stage), `${JSON.stringify(snapshot)}\n`)
}

function restoreStageSnapshot(path: string, stage: Stage, startedAt?: string): void {
  const snapshotFile = stageSnapshotFile(path, stage)
  if (existsSync(snapshotFile)) {
    const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as StageSnapshot
    for (const [file, content] of Object.entries(snapshot.files ?? {})) {
      const full = join(path, file)
      if (content === null) rmSync(full, { force: true })
      else writeFileSync(full, content)
    }
    if (stage.name === 'run-test-checklist') {
      const screenshots = join(path, 'screenshots')
      const previous = new Set(snapshot.screenshotFiles ?? [])
      for (const file of relativeFiles(screenshots)) {
        if (!previous.has(file)) rmSync(join(screenshots, file), { force: true })
      }
    }
    rmSync(snapshotFile, { force: true })
    return
  }

  // Runs created by an older app version have no snapshot. Only remove test
  // captures that can be attributed to this exact run; never guess at source files.
  if (stage.name === 'run-test-checklist' && startedAt) {
    const since = Date.parse(startedAt)
    const screenshots = join(path, 'screenshots')
    for (const file of relativeFiles(screenshots)) {
      const full = join(screenshots, file)
      if (Number.isFinite(since) && statSync(full).mtimeMs >= since) rmSync(full, { force: true })
    }
  }
}

type ModelStageSettings = { model: string; effort: NonNullable<Stage['effort']> }

interface FlowProfile {
  next: Partial<Record<Stage['name'], string>>
}

export const FLOW_PROFILES: Record<FlowLevel, FlowProfile> = {
  simples: {
    next: {
      'task-planning': 'desenvolvendo',
      'run-task-checklist': 'code-review',
      'run-test-checklist': 'code-review',
    },
  },
  medio: {
    next: {
      'task-planning': 'revisao-de-plano',
      'run-task-checklist': 'code-review',
      'run-test-checklist': 'code-review',
    },
  },
  dificil: {
    next: {
      'task-planning': 'revisao-de-plano',
      'run-task-checklist': 'auto-testing',
      'run-test-checklist': 'code-review',
    },
  },
}

const MODEL_STAGE_DEFAULTS: Record<string, ModelStageSettings> = {
  'task-planning': { model: 'fable', effort: 'high' },
  'run-task-checklist': { model: 'fable', effort: 'low' },
  'run-test-checklist': { model: 'sonnet', effort: 'low' },
}

const SETTINGS_FILE = '.mega-brain-settings.json'
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

function readStageSettings(root: string): Record<string, ModelStageSettings> {
  let saved: unknown
  try {
    saved = JSON.parse(readFileSync(join(root, SETTINGS_FILE), 'utf8'))
  } catch {
    saved = {}
  }
  const configured = saved && typeof saved === 'object' ? (saved as { stages?: unknown }).stages : undefined
  const entries = configured && typeof configured === 'object' ? configured as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(MODEL_STAGE_DEFAULTS).map(([name, defaults]) => {
    const value = entries[name]
    if (!value || typeof value !== 'object') return [name, defaults]
    const { model, effort } = value as { model?: unknown; effort?: unknown }
    return [name, {
      model: typeof model === 'string' && model.trim() ? model.trim() : defaults.model,
      effort: typeof effort === 'string' && EFFORTS.has(effort) ? effort as ModelStageSettings['effort'] : defaults.effort,
    }]
  }))
}

function writeStageSettings(root: string, stages: unknown): Record<string, ModelStageSettings> {
  if (!stages || typeof stages !== 'object') throw new Error('Configurações de etapas inválidas')
  const settings = readStageSettings(root)
  for (const name of Object.keys(MODEL_STAGE_DEFAULTS)) {
    const value = (stages as Record<string, unknown>)[name]
    if (!value || typeof value !== 'object') continue
    const { model, effort } = value as { model?: unknown; effort?: unknown }
    if (typeof model !== 'string' || !model.trim()) throw new Error(`Modelo inválido para ${name}`)
    if (typeof effort !== 'string' || !EFFORTS.has(effort)) throw new Error(`Effort inválido para ${name}`)
    settings[name] = { model: model.trim(), effort: effort as ModelStageSettings['effort'] }
  }
  writeFileSync(join(root, SETTINGS_FILE), `${JSON.stringify({ stages: settings }, null, 2)}\n`)
  return settings
}

function settingsForStage(path: string, stage: Stage): ModelStageSettings {
  return readStageSettings(dirname(path))[stage.name]
    ?? { model: stage.model ?? 'fable', effort: stage.effort ?? 'low' }
}

function stageFor(status: string): Stage | undefined {
  return STAGES.find((stage) => stage.status === status)
}

const MEGA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME_ENTRY = fileURLToPath(import.meta.url)

interface StageScriptCommandOptions {
  runtimeEntry?: string
  currentEntry?: string
  execPath?: string
  megaRoot?: string
}

export function stageScriptCommand(
  path: string,
  stage: Pick<Stage, 'name' | 'script'>,
  options: StageScriptCommandOptions = {},
): [string, string[]] {
  if (!stage.script) throw new Error(`A etapa ${stage.name} não possui script`)
  const runtimeEntry = options.runtimeEntry ?? RUNTIME_ENTRY
  const currentEntry = options.currentEntry ?? process.argv[1]
  const execPath = options.execPath ?? process.execPath
  const megaRoot = options.megaRoot ?? MEGA_ROOT
  const bundledRuntime = runtimeEntry.endsWith('.mjs')
    && Boolean(currentEntry)
    && resolve(currentEntry) === resolve(runtimeEntry)
  return bundledRuntime
    ? [execPath, [runtimeEntry, path]]
    : [join(megaRoot, 'node_modules', '.bin', 'tsx'), [join(megaRoot, stage.script), path]]
}

function stageCommand(path: string, stage: Stage, card: CardData, model: string, effort: string, provider: 'claude' | 'chatgpt' = 'claude', claude?: string, codex?: string): [string, string[]] {
  if (stage.script) {
    return stageScriptCommand(path, stage)
  }
  const prompt = (stage.prompt as (card: CardData) => string)(card)
  if (provider === 'chatgpt') {
    return [
      codexBin(codex),
      [
        'exec', '--json', '--dangerously-bypass-approvals-and-sandbox',
        ...(model && model !== 'default' ? ['--model', model] : []),
        ...(effort ? ['--config', `model_reasoning_effort="${effort}"`] : []),
        prompt,
      ],
    ]
  }
  return [
    claudeBin(claude),
    [
      '-p', prompt,
      '--model', model,
      ...(model.toLowerCase().includes('fable') ? ['--fallback-model', 'opus'] : []),
      '--effort', effort,
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
    ],
  ]
}

function runStageAgent(path: string, stage: Stage, card: CardData, model: string | undefined = undefined, claude: string | undefined = undefined, runner: ProcessRunner = nodeProcessRunner, owner?: ProcessOwner, onSpawn?: (child: ProcessChild) => void, worktreesDir?: string, provider: 'claude' | 'chatgpt' = 'claude', codex?: string): void {
  const settings = settingsForStage(path, stage)
  const effectiveModel = model ?? settings.model
  if (model === undefined) captureStageSnapshot(path, stage)
  const out = openSync(join(path, `${stage.name}.jsonl`), 'w')
  const err = openSync(join(path, `${stage.name}.log`), 'a')
  const [bin, args] = stageCommand(path, stage, card, effectiveModel, settings.effort, provider, claude, codex)
  const child = runner.spawn(bin, args, {
    cwd: path,
    detached: true,
    stdio: ['ignore', out, err],
    env: {
      ...process.env,
      CHECKLIST_MODEL: settings.model,
      CHECKLIST_EFFORT: settings.effort,
      MEGA_BRAIN_WORKTREES_DIR: worktreesDir ?? process.env.MEGA_BRAIN_WORKTREES_DIR,
      MEGA_BRAIN_LLM_PROVIDER: provider,
      MEGA_BRAIN_STAGE_SCRIPT: stage.script ? stage.name : undefined,
      MEGA_BRAIN_CLAUDE_BIN: claudeBin(claude),
      MEGA_BRAIN_CODEX_BIN: codex ?? process.env.MEGA_BRAIN_CODEX_BIN,
    },
  })
  owner?.own(child, { tree: true, label: `stage:${stage.name}` })
  onSpawn?.(child)
  child.on('error', (error) => console.error('stage:', error.message))
  child.unref()
  closeSync(out)
  closeSync(err)
  writeFileSync(
    join(path, AGENT_FILE),
    `${JSON.stringify({ pid: child.pid ?? null, startedAt: new Date().toISOString(), stage: stage.name, model: effectiveModel }, null, 2)}\n`,
  )
}

function stageEndedDueToRateLimit(path: string, stage: Stage): boolean {
  const stream = join(path, `${stage.name}.jsonl`)
  if (!existsSync(stream)) return false
  return readTail(stream, STREAM_TAIL_BYTES).split('\n').some((line) => {
    try {
      const event = JSON.parse(line)
      return event?.error === 'rate_limit' || event?.type === 'rate_limit_event'
    } catch {
      return false
    }
  })
}

function canRetryStageWithOpus(path: string, stage: Stage): boolean {
  if (stage.script || !settingsForStage(path, stage).model.toLowerCase().includes('fable')) return false
  try {
    const meta = JSON.parse(readFileSync(join(path, AGENT_FILE), 'utf8')) as { model?: unknown }
    return typeof meta.model !== 'string' || !meta.model.toLowerCase().includes('opus')
  } catch {
    return true
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function readTail(file: string, bytes: number): string {
  const size = statSync(file).size
  const start = Math.max(0, size - bytes)
  const buffer = Buffer.alloc(size - start)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, start)
  } finally {
    closeSync(fd)
  }
  return buffer.toString('utf8')
}

const RESULT_SUBTYPE_ERRORS: Record<string, string> = {
  error_max_turns: 'Limite de turnos atingido',
  error_during_execution: 'Erro durante a execução',
}

export function summarizeInput(input: Record<string, unknown> = {}): string {
  const value = input.description ?? input.file_path ?? input.pattern ?? input.command ?? input.prompt ?? ''
  return String(value).slice(0, 120)
}

export function readAgent(path: string, alive: (pid: number) => boolean = pidAlive): AgentInfo | null {
  const metaFile = join(path, AGENT_FILE)
  if (!existsSync(metaFile)) return null
  let meta: { pid?: number; startedAt?: string; stage?: string } = {}
  try {
    meta = JSON.parse(readFileSync(metaFile, 'utf8'))
  } catch {}
  const stage = STAGES.find((s) => s.name === meta.stage) ?? STAGES[0]
  const info: AgentInfo = { stage: stage.name, status: 'rodando', startedAt: meta.startedAt }
  let finished = false
  const stream = join(path, `${stage.name}.jsonl`)
  if (existsSync(stream)) {
    for (const line of readTail(stream, STREAM_TAIL_BYTES).split('\n')) {
      let event: any
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof event?.session_id === 'string') info.sessionId = event.session_id
      if (event?.type === 'thread.started' && typeof event.thread_id === 'string') info.sessionId = event.thread_id
      if (event?.type === 'result') {
        finished = true
        if (event.subtype === 'success' && !event.is_error) {
          info.status = 'concluido'
        } else {
          info.status = 'erro'
          const detail =
            typeof event.result === 'string' && event.result.trim()
              ? event.result
              : (RESULT_SUBTYPE_ERRORS[event.subtype] ?? event.subtype)
          if (detail) info.error = String(detail).trim().replace(/\s+/g, ' ').slice(0, 300)
        }
      }
      if (event?.type === 'turn.completed') {
        finished = true
        info.status = 'concluido'
      }
      if (event?.type === 'turn.failed' || event?.type === 'error') {
        finished = true
        info.status = 'erro'
        const detail = event.error?.message ?? event.message ?? 'O ChatGPT não concluiu a execução'
        info.error = String(detail).trim().replace(/\s+/g, ' ').slice(0, 300)
      }
      if (event?.type === 'assistant') {
        const tool = event.message?.content?.find?.((c: any) => c?.type === 'tool_use')
        if (tool) info.activity = [tool.name, summarizeInput(tool.input)].filter(Boolean).join(': ')
      }
      if ((event?.type === 'item.started' || event?.type === 'item.completed') && event.item) {
        info.activity = String(event.item.command ?? event.item.text ?? event.item.type ?? '').slice(0, 300)
      }
    }
  }
  if (!finished) info.status = typeof meta.pid === 'number' && alive(meta.pid) ? 'rodando' : 'morto'
  if (info.status === 'rodando') {
    const flow = readFlow(readCard(path, basename(path)).flow)
    const { done, total, phase } = stage.progress(path, meta.startedAt, flow)
    const started = Boolean(info.sessionId) || Boolean(stage.script)
    info.phase = started ? phase : 'Iniciando agente'
    info.progress = { done: started ? done : 0, total }
  }
  return info
}

export function claudeCwds(): Set<string> {
  const cwds = new Set<string>()
  let pids: string[]
  try {
    pids = readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))
  } catch {
    return cwds
  }
  for (const pid of pids) {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0', 2)
      if (!argv.some((arg) => ['claude', 'codex'].includes(basename(arg)))) continue
      cwds.add(readlinkSync(`/proc/${pid}/cwd`))
    } catch {}
  }
  return cwds
}

export function externalAgentCwd(path: string, activeCwds: Set<string>): string | undefined {
  const roots: string[] = []
  try {
    roots.push(realpathSync(path))
  } catch {
    return undefined
  }
  for (const linksRoot of [path, join(path, 'repos')]) {
    try {
      for (const entry of readdirSync(linksRoot, { withFileTypes: true })) {
        if (!entry.isSymbolicLink()) continue
        try {
          roots.push(realpathSync(join(linksRoot, entry.name)))
        } catch {}
      }
    } catch {}
  }
  for (const root of roots) {
    for (const cwd of activeCwds) {
      if (cwd === root || cwd.startsWith(`${root}/`)) return cwd
    }
  }
}

export function readExternalAgent(
  cwd: string,
  projectsRoot = join(homedir(), '.claude', 'projects'),
): AgentInfo {
  const info: AgentInfo = { status: 'rodando' }
  const projectDir = join(projectsRoot, cwd.replace(/[/.]/g, '-'))
  try {
    const sessions = readdirSync(projectDir)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => ({ path: join(projectDir, file), stat: statSync(join(projectDir, file)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    const latest = sessions[0]
    if (!latest) return info
    info.startedAt = new Date(latest.stat.birthtimeMs || latest.stat.mtimeMs).toISOString()
    let waiting = false
    for (const line of readTail(latest.path, STREAM_TAIL_BYTES).split('\n')) {
      let event: any
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event?.isSidechain) continue
      if (event?.type === 'user') waiting = false
      if (event?.type === 'assistant') {
        waiting = event.message?.stop_reason === 'end_turn'
        const tool = event.message?.content?.find?.((c: any) => c?.type === 'tool_use')
        if (tool) info.activity = [tool.name, summarizeInput(tool.input)].filter(Boolean).join(': ')
      }
    }
    if (waiting) info.status = 'aguardando'
  } catch {}
  return info
}

export function advanceStage(
  path: string,
  card: CardData,
  agent: AgentInfo | null,
  start: (path: string, stage: Stage, card: CardData) => void = runStageAgent,
): CardData {
  const stage = stageFor(card.status)
  const flow = readFlow(card.flow)
  const nextStatus = stage && FLOW_PROFILES[flow].next[stage.name]
  if (!stage || !nextStatus || agent?.status !== 'concluido' || (agent.stage ?? STAGES[0].name) !== stage.name) return card
  const next = { ...card, flow, status: nextStatus }
  rmSync(stageSnapshotFile(path, stage), { force: true })
  writeCard(path, next)
  const nextStage = stageFor(nextStatus)
  if (nextStage) start(path, nextStage, next)
  return next
}

function hasPrsForAllRepos(
  prs: CardData['prs'] | undefined,
  environment: 'staging' | 'master',
  repos: readonly string[],
): boolean {
  const links = prs?.[environment]
  return repos.length > 0 && repos.every((repo) => Boolean(links?.[repo]))
}

// O resultado do agente é transitório; os arquivos jsonl permanecem como histórico.
// Quando o card já avançou (manualmente ou por outro fluxo), não deixamos uma falha
// antiga continuar sinalizando erro no board.
export function isResolvedAgentError(card: CardData, agent: AgentInfo | null, repos: readonly string[] = []): boolean {
  if (agent?.status !== 'erro' || !agent.stage) return false
  const agentStage = STAGES.find((stage) => stage.name === agent.stage)
  if (!agentStage) return false
  if (card.status !== agentStage.status) return true
  if (agentStage.name === 'stage-task') return hasPrsForAllRepos(card.prs, 'staging', repos)
  if (agentStage.name === 'master-pr-task') return card.status === 'producao' || hasPrsForAllRepos(card.prs, 'master', repos)
  return false
}

const PRODUCTION_TTL_MS = 24 * 60 * 60 * 1000

export function expiredInProduction(path: string, card: CardData, now = Date.now()): boolean {
  if (card.status !== 'producao') return false
  const file = join(path, 'card.json')
  return existsSync(file) && now - statSync(file).mtimeMs > PRODUCTION_TTL_MS
}

function isInside(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path)
  return Boolean(pathFromRoot) && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..'
}

function nestedGitWorktrees(root: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (entry.isFile() && entry.name === '.git') found.push(path)
    }
  }
  visit(root)
  return found
}

// Companions (api-core/takeat-services/api-garcom-digital) ficam ao lado das
// worktrees da task sem symlink no card, então só aparecem varrendo a pasta.
function companionWorktrees(reposRoot: string): string[] {
  if (!existsSync(reposRoot)) return []
  return readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && statSync(join(reposRoot, entry.name, '.git'), { throwIfNoEntry: false })?.isFile())
    .map((entry) => join(reposRoot, entry.name))
}

function cardWorktreeRepos(cardPath: string, worktreesRoot: string): { name: string; path: string }[] {
  const repos = new Map(cardRepos(cardPath).map((repo) => [repo.name, repo]))
  const managedRepos = join(worktreesRoot, basename(cardPath), 'repos')
  for (const path of companionWorktrees(managedRepos)) {
    const name = basename(path)
    if (!repos.has(name)) repos.set(name, { name, path })
  }
  return [...repos.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function hasMissingWorktreeRegistration(worktree: string): boolean {
  const metadata = join(worktree, '.git')
  try {
    const match = /^gitdir:\s*(.+)\s*$/i.exec(readFileSync(metadata, 'utf8'))
    if (!match) return false
    return !existsSync(resolve(dirname(metadata), match[1]))
  } catch {
    return false
  }
}

function removeCardWorktrees(cardPath: string, worktreesRoot: string, git: string | undefined, runner: ProcessRunner): void {
  const root = resolve(worktreesRoot)
  const mainRepos = new Set<string>()
  const worktrees = new Map<string, string>()
  for (const repo of cardRepos(cardPath)) worktrees.set(resolve(repo.path), repo.name)
  const taskRoot = join(root, basename(cardPath))
  for (const worktree of companionWorktrees(join(taskRoot, 'repos'))) worktrees.set(resolve(worktree), basename(worktree))
  const itemRoot = join(taskRoot, 'items')
  for (const worktree of nestedGitWorktrees(itemRoot)) worktrees.set(resolve(worktree), basename(worktree))
  for (const [worktree, name] of worktrees) {
    // A card can contain arbitrary symlinks. Only the managed worktree
    // directory is eligible for deletion when its card is removed.
    if (!isInside(root, worktree)) continue
    try {
      const commonGitDir = gitOut(worktree, git, runner, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim()
      if (!commonGitDir) throw new Error('repositório Git inválido')
      const mainRepo = dirname(commonGitDir)
      gitOut(mainRepo, git, runner, 'worktree', 'remove', '--force', worktree)
      mainRepos.add(mainRepo)
    } catch (error) {
      // Git may have pruned the registration already (or the main repository
      // may have been recreated) while the managed checkout remained on disk.
      // In that state `git worktree remove` is impossible. Direct removal is
      // safe here because `worktree` was proven to be inside our managed root
      // and its `.git` file points to a registration that no longer exists.
      if (hasMissingWorktreeRegistration(worktree)) {
        rmSync(worktree, { recursive: true, force: true })
        continue
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Não foi possível remover a worktree ${name}: ${reason}`)
    }
  }
  for (const mainRepo of mainRepos) gitOut(mainRepo, git, runner, 'worktree', 'prune')
  // Runs can be interrupted before Git creates a checkout. Remove the empty
  // item container too, so a deleted card never leaves task residue behind.
  rmSync(itemRoot, { recursive: true, force: true })
}

function deleteCard(cardPath: string, worktreesRoot: string, git: string | undefined, runner: ProcessRunner): void {
  stopDevEnv(cardPath)
  removeCardWorktrees(cardPath, worktreesRoot, git, runner)
  rmSync(cardPath, { recursive: true, force: true })
}

function listFolders(
  root: string,
  worktreesRoot: string,
  git: string | undefined,
  runner: ProcessRunner,
  startStage: (path: string, stage: Stage, card: CardData, model?: string) => void,
) {
  mkdirSync(root, { recursive: true })
  const activeCwds = claudeCwds()
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .flatMap((entry) => {
      const path = join(root, entry.name)
      const card = readCard(path, entry.name)
      if (expiredInProduction(path, card)) {
        deleteCard(path, worktreesRoot, git, runner)
        return []
      }
      const stat = statSync(path)
      let agent = readAgent(path)
      const stage = stageFor(card.status)
      if (isResolvedAgentError(card, agent, cardRepos(path).map((repo) => repo.name))) {
        unlinkSync(join(path, AGENT_FILE))
        agent = null
      }
      if (
        agent?.status === 'erro' &&
        stage &&
        agent.stage === stage.name &&
        stageEndedDueToRateLimit(path, stage) &&
        canRetryStageWithOpus(path, stage)
      ) {
        startStage(path, stage, card, 'opus')
        agent = readAgent(path)
      }
      const advanced = advanceStage(path, card, agent, startStage)
      if (advanced !== card) agent = readAgent(path)
      const agents = agent ? [agent] : []
      if (agent?.status !== 'rodando') {
        const cwd = externalAgentCwd(path, activeCwds)
        if (cwd) agents.push(readExternalAgent(cwd))
      }
      const prUrls = Object.values(advanced.prs?.staging ?? {}).concat(
        Object.values(advanced.prs?.master ?? {}),
      )
      const cardFile = join(path, 'card.json')
      const updatedAt = existsSync(cardFile)
        ? new Date(statSync(cardFile).mtimeMs).toISOString()
        : new Date(stat.mtimeMs).toISOString()
      return {
        name: entry.name,
        path,
        createdAt: new Date(stat.birthtimeMs || stat.mtimeMs).toISOString(),
        updatedAt,
        agents,
        devEnv: readDevEnv(path),
        prStates: prUrls.length ? prStates(prUrls) : undefined,
        ...advanced,
      }
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

const ARTIFACT_PHASES = [
  ['PLAN.md', 'Criando plano'],
  ['TASK-CHECKLIST.md', 'Criando tasks'],
  ['TEST-CHECKLIST.md', 'Criando testes'],
] as const

export const CARD_FILES = ARTIFACT_PHASES.map(([file]) => file)

function planningProgress(path: string, startedAt?: string, flow: FlowLevel = DEFAULT_FLOW): StageProgress {
  const since = startedAt ? Date.parse(startedAt) : 0
  const artifacts = flow === 'simples'
    ? ARTIFACT_PHASES.slice(1, 2)
    : flow === 'medio'
      ? ARTIFACT_PHASES.slice(0, 2)
      : ARTIFACT_PHASES
  let done = 0
  let phase = 'Finalizando'
  for (const [file, label] of artifacts) {
    const artifact = join(path, file)
    if (existsSync(artifact) && statSync(artifact).mtimeMs >= since) done++
    else if (phase === 'Finalizando') phase = label
  }
  return { done, total: artifacts.length, phase }
}

const CHECKBOX = /^\s*[-*]\s*\[([ xX!-])\]\s*(.*)/

function checklistProgress(file: string): (path: string) => StageProgress {
  return (path) => {
    const full = join(path, file)
    if (!existsSync(full)) return { done: 0, total: 1, phase: `Aguardando ${file}` }
    const boxes = readFileSync(full, 'utf8')
      .split('\n')
      .map((line) => CHECKBOX.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
    const done = boxes.filter((match) => match[1] === 'x' || match[1] === 'X').length
    const pending = boxes.find((match) => match[1] === ' ')
    return {
      done,
      total: boxes.length || 1,
      phase: pending ? pending[2].replace(/\{[^}]*\}\s*$/, '').trim().slice(0, 60) : 'Finalizando',
    }
  }
}

function cardRepos(path: string): { name: string; path: string }[] {
  const linksRoot = existsSync(join(path, 'repos')) ? join(path, 'repos') : path
  return readdirSync(linksRoot, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .flatMap((entry) => {
      try {
        const real = realpathSync(join(linksRoot, entry.name))
        return existsSync(join(real, '.git')) ? [{ name: entry.name, path: real }] : []
      } catch {
        return []
      }
    })
}

export interface WorktreeRepoInfo {
  name: string
  path: string
  repository: string
  remote?: string
  branch: string
  head: { hash: string; shortHash: string; subject: string; committedAt: string }
  base?: { ref: string; hash: string; shortHash: string; inferred: boolean; createdAt?: string }
  dirty: boolean
  error?: string
}

function gitOut(cwd: string, git: string | undefined, runner: ProcessRunner, ...args: string[]): string {
  return String(runner.execFileSync(git ?? 'git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
}

function optionalGitOut(cwd: string, git: string | undefined, runner: ProcessRunner, ...args: string[]): string | undefined {
  try {
    return gitOut(cwd, git, runner, ...args).trim() || undefined
  } catch {
    return undefined
  }
}

function worktreeBaseRef(cwd: string, git: string | undefined, runner: ProcessRunner): string | undefined {
  const remoteHead = optionalGitOut(cwd, git, runner, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  if (remoteHead) return remoteHead
  return ['origin/master', 'origin/main'].find((ref) =>
    Boolean(optionalGitOut(cwd, git, runner, 'rev-parse', '--verify', '--quiet', ref)),
  )
}

/** Git metadata shown in the card so a checkout can be traced back to its base version. */
export function worktreeRepoInfo(
  repo: { name: string; path: string },
  git?: string,
  runner: ProcessRunner = nodeProcessRunner,
  recordedOrigin?: WorktreeOrigin,
): WorktreeRepoInfo {
  try {
    const [hash, shortHash, subject, committedAt] = gitOut(
      repo.path, git, runner, 'show', '-s', '--format=%H%x00%h%x00%s%x00%cI', 'HEAD',
    ).trim().split('\0')
    const commonGitDir = gitOut(repo.path, git, runner, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim()
    const baseRef = recordedOrigin?.ref ?? worktreeBaseRef(repo.path, git, runner)
    const baseHash = recordedOrigin?.hash ?? (baseRef
      ? optionalGitOut(repo.path, git, runner, 'merge-base', baseRef, 'HEAD')
      : undefined)
    return {
      name: repo.name,
      path: repo.path,
      repository: recordedOrigin?.repository ?? dirname(commonGitDir),
      remote: optionalGitOut(repo.path, git, runner, 'remote', 'get-url', 'origin'),
      branch: gitOut(repo.path, git, runner, 'rev-parse', '--abbrev-ref', 'HEAD').trim(),
      head: { hash, shortHash, subject, committedAt },
      base: baseRef && baseHash ? {
        ref: baseRef,
        hash: baseHash,
        shortHash: baseHash.slice(0, 7),
        inferred: !recordedOrigin,
        createdAt: recordedOrigin?.createdAt,
      } : undefined,
      dirty: Boolean(gitOut(repo.path, git, runner, 'status', '--porcelain').trim()),
    }
  } catch (error) {
    return {
      name: repo.name,
      path: repo.path,
      repository: repo.path,
      branch: 'desconhecida',
      head: { hash: '', shortHash: '', subject: '', committedAt: '' },
      dirty: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function diffBase(cwd: string, git: string | undefined, runner: ProcessRunner): string {
  const heads = ['origin/master', 'origin/main']
  try {
    heads.unshift(gitOut(cwd, git, runner, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim())
  } catch {}
  for (const head of heads) {
    try {
      return gitOut(cwd, git, runner, 'merge-base', head, 'HEAD').trim()
    } catch {}
  }
  return 'HEAD'
}

// git diff --no-index sai com código 1 quando há diferenças
function untrackedDiff(cwd: string, file: string, git: string | undefined, runner: ProcessRunner): string {
  try {
    return gitOut(cwd, git, runner, 'diff', '--no-color', '--no-index', '/dev/null', file)
  } catch (error: any) {
    return typeof error?.stdout === 'string' ? error.stdout : ''
  }
}

export function repoDiff(cwd: string, git?: string, runner: ProcessRunner = nodeProcessRunner): string {
  const tracked = gitOut(cwd, git, runner, 'diff', '--no-color', diffBase(cwd, git, runner))
  const untracked = gitOut(cwd, git, runner, 'ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter(Boolean)
    .map((file) => untrackedDiff(cwd, file, git, runner))
  return [tracked, ...untracked].filter(Boolean).join('')
}

// wsl.exe não carrega o PATH do usuário, então o terminal precisa do caminho absoluto
export function claudeBin(configured?: string): string {
  if (configured) return configured
  const userInstall = join(homedir(), '.local', 'bin', 'claude')
  if (existsSync(userInstall)) return userInstall
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const bin = join(dir, 'claude')
    if (dir && existsSync(bin)) return bin
  }
  return 'claude'
}

export function codexBin(configured?: string): string {
  if (configured) return configured
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const bin = join(dir, 'codex')
    if (dir && existsSync(bin)) return bin
  }
  return 'codex'
}

// explorer.exe só abre uma URL por vez; chamar o Chrome direto agrupa tudo numa janela nova
function openBrowser(urls: string[], browser: string | undefined, runner: ProcessRunner): void {
  const command = resolveOptionalExecutable({ configured: browser, candidates: wslDesktopCandidates('browser'), label: 'Chrome ou outro navegador' })
  const child = process.env.WSL_DISTRO_NAME
    ? runner.spawn(command, ['--new-window', ...urls], {
        detached: true,
        stdio: 'ignore',
      })
    : runner.spawn(command, ['--new-window', ...urls], { detached: true, stdio: 'ignore' })
  child.on('error', (error) => console.error('browser:', error.message))
  child.unref()
}

function openTerminal(cwd: string, args: string[], terminal: string | undefined, runner: ProcessRunner): void {
  const command = resolveOptionalExecutable({ configured: terminal, candidates: wslDesktopCandidates('terminal'), label: 'Windows Terminal' })
  const child = process.env.WSL_DISTRO_NAME
    ? runner.spawn(command, ['wsl.exe', '--cd', cwd, '--', ...args], { detached: true, stdio: 'ignore' })
    : runner.spawn(command, ['-e', ...args], { cwd, detached: true, stdio: 'ignore' })
  child.on('error', (error) => console.error('terminal:', error.message))
  child.unref()
}

export interface WorkspaceService { handle(path: string, method: string, query: URLSearchParams, body: unknown): Promise<unknown> }

type WorkspaceConfigInput = Pick<MegaBrainConfig, 'workspaceDir' | 'executables'> & Partial<Pick<MegaBrainConfig, 'worktreesDir' | 'preferences'>>

function completeWorkspaceConfig(input: WorkspaceConfigInput): MegaBrainConfig {
  if (input.worktreesDir && input.preferences) return input as MegaBrainConfig
  const home = homedir()
  const workspaceDir = input.workspaceDir
  return {
    mode: 'web',
    server: { host: '127.0.0.1', port: 0 },
    workspaceDir,
    worktreesDir: input.worktreesDir ?? join(dirname(resolve(workspaceDir)), 'worktrees'),
    jira: {},
    directories: {
      home,
      claudeHome: join(home, '.claude'),
      claudeProjects: join(home, '.claude', 'projects'),
      claudeCredentials: join(home, '.claude', '.credentials.json'),
    },
    executables: input.executables,
    preferences: input.preferences ?? {
      settingsFile: join(dirname(resolve(workspaceDir)), '.mega-brain-global-settings.json'),
      editor: 'cursor',
      editorCommand: '',
      llmProvider: 'claude',
      onboardingCompleted: true,
    },
  }
}

/** All workspace behavior is intentionally owned by this Vite-free service. */
export function createWorkspaceService(inputConfig: WorkspaceConfigInput, runner: ProcessRunner = nodeProcessRunner, owner?: ProcessOwner): WorkspaceService {
  const config = completeWorkspaceConfig(inputConfig)
  const runningStages = new Map<string, { stage: string; child: ProcessChild }>()
  const startStage = (path: string, stage: Stage, card: CardData, model?: string) => {
    runStageAgent(path, stage, card, model, config.executables.claude, runner, owner, (child) => {
      const run = { stage: stage.name, child }
      runningStages.set(path, run)
      const forget = () => {
        if (runningStages.get(path) === run) runningStages.delete(path)
      }
      child.once('exit', forget)
      child.once('close', forget)
      child.once('error', forget)
    }, config.worktreesDir, config.preferences.llmProvider, config.executables.codex)
  }
  const stopStage = async (cardPath: string, requestedStage: unknown) => {
    const stageName = String(requestedStage ?? '')
    const stage = STAGES.find((candidate) => candidate.name === stageName)
    if (!stage) throw new Error('Etapa automática inválida')
    const agent = readAgent(cardPath)
    if (agent?.stage !== stage.name || agent.status !== 'rodando') {
      throw new Error('Essa execução já terminou ou não está mais ativa')
    }
    const run = runningStages.get(cardPath)
    if (!run || run.stage !== stage.name) {
      throw new Error('Não é possível interromper uma execução iniciada por outra sessão do aplicativo')
    }
    // Hide the run before signalling it so a concurrent board poll cannot
    // advance the card if the process emits a final success while stopping.
    rmSync(join(cardPath, AGENT_FILE), { force: true })
    if (owner) await owner.stop(run.child)
    else run.child.kill('SIGTERM')
    runningStages.delete(cardPath)
    restoreStageSnapshot(cardPath, stage, agent.startedAt)
    for (const file of [`${stage.name}.jsonl`, `${stage.name}.log`]) {
      rmSync(join(cardPath, file), { force: true })
    }
  }
  return { async handle(path, method, query, body) {
    let root = resolve(config.workspaceDir)
    assertTestWorkspace(root)
    let paths = createWorkspacePathResolver(root)
    let folder = (value: unknown) => paths.resolveCardFolder(value)
    // Startup must be observational. Creating a missing configured workspace
    // is a deliberate consequence of the first workspace request instead.
    mkdirSync(root, { recursive: true })
    if (method === 'GET') {
      if (path === '/settings/editors') return detectEditors(config)
      if (path === '/settings') return { general: readGeneralSettings(config), stages: readStageSettings(root) }
      if (path === '/') return listFolders(root, resolve(config.worktreesDir), config.executables.git, runner, startStage)
      const card = folder(query.get('name'))
      if (path === '/detail') return {
        files: Object.fromEntries(CARD_FILES.map((file) => [file, existsSync(join(card.path, file)) ? readFileSync(join(card.path, file), 'utf8') : null])),
        repos: cardWorktreeRepos(card.path, resolve(config.worktreesDir))
          .map((repo) => worktreeRepoInfo(repo, config.executables.git, runner, readCard(card.path, card.name).worktrees?.[repo.name])),
      }
      if (path === '/diff') return { repos: cardRepos(card.path).map((repo) => { try { return { name: repo.name, diff: repoDiff(repo.path, config.executables.git, runner) } } catch (error) { return { name: repo.name, diff: '', error: error instanceof Error ? error.message : String(error) } } }) }
      return listFolders(root, resolve(config.worktreesDir), config.executables.git, runner, startStage)
    }
    if (method !== 'POST') throw new Error('Método não suportado')
    const data = (body ?? {}) as Record<string, unknown>
    if (path === '/settings') {
      const general = data.general === undefined ? readGeneralSettings(config) : writeGeneralSettings(config, data.general)
      root = resolve(config.workspaceDir)
      assertTestWorkspace(root)
      mkdirSync(root, { recursive: true })
      paths = createWorkspacePathResolver(root)
      folder = (value: unknown) => paths.resolveCardFolder(value)
      return { general, stages: data.stages === undefined ? readStageSettings(root) : writeStageSettings(root, data.stages) }
    }
    if (path === '/open') { const card = folder(data.name); const editor = editorExecutable(config); const child = runner.spawn(editor, [card.path], { detached: true, stdio: 'ignore' }); child.on('error', (error) => console.error('editor:', error.message)); child.unref(); return { ok: true } }
    if (path === '/') return createCard(root, data)
    const card = folder(data.name); const { name, path: cardPath } = card
    if (path === '/terminal') {
      const id = readAgent(cardPath)?.sessionId
      if (!id) throw new Error('O agente ainda não registrou a sessão')
      const command = config.preferences.llmProvider === 'chatgpt'
        ? [codexBin(config.executables.codex), 'resume', id]
        : [claudeBin(config.executables.claude), '--resume', id]
      openTerminal(cardPath, command, config.executables.terminal, runner)
      return { ok: true }
    }
    if (path === '/prs/open') {
      const env = data.env
      if (env !== 'staging' && env !== 'master') throw new Error(`Ambiente inválido: ${env}`)
      const links = readCard(cardPath, name).prs?.[env] ?? {}
      const project = typeof data.project === 'string' ? data.project : undefined
      const candidates = project ? [links[project]] : Object.values(links)
      const urls = candidates.filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
      if (!urls.length) throw new Error(project ? `Sem PR de ${env} para ${project}` : `Sem PRs de ${env}`)
      openBrowser(urls, config.executables.browser, runner)
      return { ok: true }
    }
    if (path === '/dev-env/stop') { stopDevEnv(cardPath); return { ok: true } }
    if (path === '/dev-env/open') {
      const repo = String(data.repo ?? '')
      const app = readDevEnv(cardPath)?.apps.find((candidate) => candidate.repo === repo)
      if (app?.status !== 'rodando' || !app.url) throw new Error(`Ambiente não está rodando: ${repo}`)
      const url = new URL(app.url)
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || !url.port || url.username || url.password) {
        throw new Error('URL do ambiente inválida')
      }
      openBrowser([url.origin], config.executables.browser, runner)
      return { ok: true }
    }
    if (path === '/dev-env/agent') {
      const command = config.preferences.llmProvider === 'chatgpt'
        ? [codexBin(config.executables.codex), '--dangerously-bypass-approvals-and-sandbox', '/run-test-env']
        : [claudeBin(config.executables.claude), '--model', 'haiku', '--dangerously-skip-permissions', '/run-test-env']
      openTerminal(cardPath, command, config.executables.terminal, runner)
      return { ok: true }
    }
    if (path === '/stage/reset') { await stopStage(cardPath, data.stage); return { ok: true } }
    if (path === '/dev-env') return { ok: true, ...startDevEnv(cardPath, data.frontend ? String(data.frontend) : undefined, owner ? createOwnedProcessRunner(runner, owner) : runner) }
    if (path === '/update') { const previous = readCard(cardPath, name); const next = { ...previous, title: data.title === undefined ? previous.title : String(data.title), description: data.description === undefined ? previous.description : String(data.description), status: data.status === undefined ? previous.status : String(data.status), flow: readFlow(data.flow === undefined ? previous.flow : data.flow) }; writeCard(cardPath, next); const stage = stageFor(next.status); if (stage && next.status !== previous.status) startStage(cardPath, stage, next); return { ok: true } }
    if (path === '/delete') { deleteCard(cardPath, resolve(config.worktreesDir), config.executables.git, runner); return { ok: true } }
    throw new Error('Rota não encontrada')
  } }
}
