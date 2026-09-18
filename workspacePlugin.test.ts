import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  advanceStage,
  expiredInProduction,
  externalAgentCwd,
  FLOW_PROFILES,
  isResolvedAgentError,
  readAgent,
  readCard,
  readExternalAgent,
  slugify,
  STAGES,
} from './workspacePlugin'

test('slugify', () => {
  expect(slugify('Corrigir divisão de pagamentos')).toBe('corrigir-divisao-de-pagamentos')
  expect(slugify('  Fix: bug #42 (urgente!)  ')).toBe('fix-bug-42-urgente')
  expect(slugify('///')).toBe('task')
  expect(slugify('a'.repeat(100))).toHaveLength(60)
})

test('readCard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'))
  expect(readCard(dir, 'minha-task')).toEqual({ title: 'minha-task', description: '', status: 'a-fazer', flow: 'dificil' })

  writeFileSync(join(dir, 'card.json'), JSON.stringify({ title: 'Fix bug', description: 'detalhes', status: 'staging' }))
  expect(readCard(dir, 'minha-task')).toEqual({ title: 'Fix bug', description: 'detalhes', status: 'staging', flow: 'dificil' })

  writeFileSync(join(dir, 'card.json'), JSON.stringify({ title: 'Fix bug', status: 'a-fazer', flow: 'simples' }))
  expect(readCard(dir, 'minha-task').flow).toBe('simples')

  writeFileSync(
    join(dir, 'card.json'),
    JSON.stringify({
      title: 'Fix bug',
      status: 'staging',
      prs: { staging: { 'takeat-app': 'https://github.com/x/1' }, master: { 'takeat-app': 42 } },
    }),
  )
  expect(readCard(dir, 'minha-task').prs).toEqual({ staging: { 'takeat-app': 'https://github.com/x/1' } })

  writeFileSync(join(dir, 'card.json'), '{quebrado')
  expect(readCard(dir, 'minha-task')).toEqual({ title: 'minha-task', description: '', status: 'a-fazer', flow: 'dificil' })
})

test('readAgent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-'))
  expect(readAgent(dir)).toBeNull()

  writeFileSync(join(dir, 'agent.json'), JSON.stringify({ pid: 1234, startedAt: '2026-01-01T00:00:00.000Z' }))
  expect(readAgent(dir, () => true)).toMatchObject({
    status: 'rodando',
    phase: 'Iniciando agente',
    progress: { done: 0, total: 3 },
  })

  writeFileSync(
    join(dir, 'task-planning.jsonl'),
    [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-123' }),
      JSON.stringify({
        type: 'assistant',
        session_id: 'abc-123',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/a.ts' } }] },
      }),
      '{linha quebrada',
    ].join('\n'),
  )
  expect(readAgent(dir, () => true)).toEqual({
    sessionId: 'abc-123',
    stage: 'task-planning',
    status: 'rodando',
    startedAt: '2026-01-01T00:00:00.000Z',
    activity: 'Read: /repo/a.ts',
    phase: 'Criando plano',
    progress: { done: 0, total: 3 },
  })
  expect(readAgent(dir, () => false)).toMatchObject({ status: 'morto' })

  writeFileSync(join(dir, 'PLAN.md'), '# plano')
  expect(readAgent(dir, () => true)).toMatchObject({
    phase: 'Criando tasks',
    progress: { done: 1, total: 3 },
  })
  writeFileSync(join(dir, 'TASK-CHECKLIST.md'), '- [ ] task')
  writeFileSync(join(dir, 'TEST-CHECKLIST.md'), '- [ ] teste')
  expect(readAgent(dir, () => true)).toMatchObject({
    phase: 'Finalizando',
    progress: { done: 3, total: 3 },
  })

  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'abc-123' })
  writeFileSync(join(dir, 'task-planning.jsonl'), `${result}\n`)
  expect(readAgent(dir, () => false)).toMatchObject({ status: 'concluido', sessionId: 'abc-123' })

  const failure = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'abc-123' })
  writeFileSync(join(dir, 'task-planning.jsonl'), `${failure}\n`)
  expect(readAgent(dir, () => true)).toMatchObject({ status: 'erro', error: 'Erro durante a execução' })

  const failureWithMessage = JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    result: 'Itens: 1/3 concluídos, 2 falhas\nT2: Timeout após 20min',
  })
  writeFileSync(join(dir, 'task-planning.jsonl'), `${failureWithMessage}\n`)
  expect(readAgent(dir, () => true)).toMatchObject({
    status: 'erro',
    error: 'Itens: 1/3 concluídos, 2 falhas T2: Timeout após 20min',
  })
})

test('readAgent com stage de checklist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-checklist-'))
  writeFileSync(
    join(dir, 'agent.json'),
    JSON.stringify({ pid: 1234, startedAt: '2026-01-01T00:00:00.000Z', stage: 'run-task-checklist' }),
  )
  writeFileSync(
    join(dir, 'run-task-checklist.jsonl'),
    `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'dev-1' })}\n`,
  )
  expect(readAgent(dir, () => true)).toMatchObject({
    stage: 'run-task-checklist',
    status: 'rodando',
    phase: 'Aguardando TASK-CHECKLIST.md',
  })

  writeFileSync(join(dir, 'TASK-CHECKLIST.md'), '- [x] criar rota\n- [ ] ajustar tela\n- [ ] validar fluxo\n')
  expect(readAgent(dir, () => true)).toMatchObject({
    phase: 'ajustar tela',
    progress: { done: 1, total: 3 },
  })

  writeFileSync(join(dir, 'TASK-CHECKLIST.md'), '- [x] criar rota\n- [-] ajustar tela\n- [!] validar fluxo\n- [ ] revisar\n')
  expect(readAgent(dir, () => true)).toMatchObject({
    phase: 'revisar',
    progress: { done: 1, total: 4 },
  })

  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'dev-1' })
  writeFileSync(join(dir, 'run-task-checklist.jsonl'), `${result}\n`)
  expect(readAgent(dir, () => false)).toMatchObject({ stage: 'run-task-checklist', status: 'concluido' })
})

test('readExternalAgent', () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'projects-'))
  const cardPath = '/ws/minha.task'

  expect(readExternalAgent(cardPath, projectsRoot)).toEqual({ status: 'rodando' })

  const projectDir = join(projectsRoot, '-ws-minha-task')
  mkdirSync(projectDir)
  expect(readExternalAgent(cardPath, projectsRoot)).toEqual({ status: 'rodando' })

  writeFileSync(
    join(projectDir, 'sessao-1.jsonl'),
    [
      JSON.stringify({ type: 'user', message: { content: 'oi' } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/b.ts' } }] },
      }),
      '{linha quebrada',
    ].join('\n'),
  )
  const info = readExternalAgent(cardPath, projectsRoot)
  expect(info).toMatchObject({ status: 'rodando', activity: 'Edit: /repo/b.ts' })
  expect(info.startedAt).toBeDefined()

  const endTurn = JSON.stringify({
    type: 'assistant',
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'pronto' }] },
  })
  appendFileSync(join(projectDir, 'sessao-1.jsonl'), `\n${endTurn}\n`)
  expect(readExternalAgent(cardPath, projectsRoot)).toMatchObject({ status: 'aguardando' })

  appendFileSync(
    join(projectDir, 'sessao-1.jsonl'),
    `${JSON.stringify({ type: 'user', message: { content: 'continua' } })}\n`,
  )
  expect(readExternalAgent(cardPath, projectsRoot)).toMatchObject({ status: 'rodando' })

  appendFileSync(join(projectDir, 'sessao-1.jsonl'), `${JSON.stringify({ ...JSON.parse(endTurn), isSidechain: true })}\n`)
  expect(readExternalAgent(cardPath, projectsRoot)).toMatchObject({ status: 'rodando' })
})

test('externalAgentCwd casa a pasta do card e os worktrees symlinkados', () => {
  const root = mkdtempSync(join(tmpdir(), 'external-'))
  const card = join(root, 'card')
  const worktree = join(root, 'worktrees', 'ESTR-457', 'api-clube')
  mkdirSync(card)
  mkdirSync(worktree, { recursive: true })
  mkdirSync(join(root, 'fora'))
  symlinkSync(worktree, join(card, 'api-clube'))
  symlinkSync(join(root, 'sumiu'), join(card, 'quebrado'))
  const realCard = realpathSync(card)
  const realWorktree = realpathSync(worktree)

  expect(externalAgentCwd(card, new Set())).toBeUndefined()
  expect(externalAgentCwd(card, new Set([realpathSync(join(root, 'fora'))]))).toBeUndefined()
  expect(externalAgentCwd(card, new Set([realCard]))).toBe(realCard)
  expect(externalAgentCwd(card, new Set([realWorktree]))).toBe(realWorktree)
  expect(externalAgentCwd(card, new Set([join(realWorktree, 'src')]))).toBe(join(realWorktree, 'src'))
  expect(externalAgentCwd(card, new Set([`${realWorktree}-outro`]))).toBeUndefined()
  expect(externalAgentCwd(join(root, 'inexistente'), new Set([realCard]))).toBeUndefined()
})

test('expiredInProduction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'producao-'))
  const producao = { title: 'Fix bug', description: '', status: 'producao' }

  expect(expiredInProduction(dir, producao)).toBe(false)

  writeFileSync(join(dir, 'card.json'), JSON.stringify(producao))
  expect(expiredInProduction(dir, producao)).toBe(false)

  const old = (Date.now() - 25 * 60 * 60 * 1000) / 1000
  utimesSync(join(dir, 'card.json'), old, old)
  expect(expiredInProduction(dir, producao)).toBe(true)
  expect(expiredInProduction(dir, { ...producao, status: 'staging' })).toBe(false)
})

test('advanceStage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advance-'))
  const card = { title: 'Fix bug', description: '', status: 'planejando' }
  const done = { status: 'concluido' as const, stage: 'task-planning' }
  const started: string[] = []
  const start = (_path: string, stage: (typeof STAGES)[number]) => started.push(stage.name)

  expect(advanceStage(dir, card, null, start)).toEqual(card)
  expect(advanceStage(dir, card, { status: 'rodando' }, start)).toEqual(card)
  expect(advanceStage(dir, { ...card, status: 'a-fazer' }, done, start)).toEqual({ ...card, status: 'a-fazer' })
  expect(advanceStage(dir, card, { status: 'concluido', stage: 'run-task-checklist' }, start)).toEqual(card)

  expect(advanceStage(dir, card, done, start)).toEqual({ ...card, flow: 'dificil', status: 'revisao-de-plano' })
  expect(readCard(dir, 'fix-bug')).toEqual({ ...card, flow: 'dificil', status: 'revisao-de-plano' })
  expect(started).toEqual([])

  const dev = { ...card, status: 'desenvolvendo' }
  const devDone = { status: 'concluido' as const, stage: 'run-task-checklist' }
  expect(advanceStage(dir, dev, devDone, start)).toEqual({ ...card, flow: 'dificil', status: 'auto-testing' })
  expect(started).toEqual(['run-test-checklist'])

  const testing = { ...card, status: 'auto-testing' }
  const testDone = { status: 'concluido' as const, stage: 'run-test-checklist' }
  expect(advanceStage(dir, testing, testDone, start)).toEqual({ ...card, flow: 'dificil', status: 'code-review' })
  expect(started).toEqual(['run-test-checklist'])

  const staging = { ...card, status: 'staging' }
  const stagingDone = { status: 'concluido' as const, stage: 'stage-task' }
  expect(advanceStage(dir, staging, stagingDone, start)).toEqual(staging)
  expect(started).toEqual(['run-test-checklist'])

  const waiting = { ...card, status: 'aguardando-deploy' }
  const waitingDone = { status: 'concluido' as const, stage: 'master-pr-task' }
  expect(advanceStage(dir, waiting, waitingDone, start)).toEqual(waiting)
  expect(started).toEqual(['run-test-checklist'])
})

test('advanceStage respeita os fluxos simples e médio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advance-flow-'))
  const started: string[] = []
  const start = (_path: string, stage: (typeof STAGES)[number]) => started.push(stage.name)
  const planningDone = { status: 'concluido' as const, stage: 'task-planning' }
  const devDone = { status: 'concluido' as const, stage: 'run-task-checklist' }

  const simple = { title: 'Ajuste pequeno', description: '', status: 'planejando', flow: 'simples' as const }
  expect(advanceStage(dir, simple, planningDone, start)).toMatchObject({ status: 'desenvolvendo', flow: 'simples' })
  expect(started).toEqual(['run-task-checklist'])
  expect(advanceStage(dir, { ...simple, status: 'desenvolvendo' }, devDone, start)).toMatchObject({ status: 'code-review' })
  expect(started).toEqual(['run-task-checklist'])

  const mediumPlanning = { ...simple, flow: 'medio' as const }
  expect(advanceStage(dir, mediumPlanning, planningDone, start)).toMatchObject({ status: 'revisao-de-plano', flow: 'medio' })
  expect(started).toEqual(['run-task-checklist'])
  expect(advanceStage(dir, { ...mediumPlanning, status: 'desenvolvendo' }, devDone, start)).toMatchObject({ status: 'code-review' })
  expect(started).toEqual(['run-task-checklist'])
})

test('isResolvedAgentError limpa somente erros superados ou comprovadamente resolvidos', () => {
  const card = { title: 'Fix bug', description: '', status: 'code-review' }
  const developmentError = { status: 'erro' as const, stage: 'run-task-checklist' }
  expect(isResolvedAgentError(card, developmentError)).toBe(true)

  const currentTestError = { status: 'erro' as const, stage: 'run-test-checklist' }
  expect(isResolvedAgentError({ ...card, status: 'auto-testing' }, currentTestError)).toBe(false)

  const stagingError = { status: 'erro' as const, stage: 'stage-task' }
  expect(isResolvedAgentError({ ...card, status: 'staging' }, stagingError)).toBe(false)
  expect(isResolvedAgentError({
    ...card,
    status: 'staging',
    prs: { staging: { api: 'https://github.com/example/api/pull/1' } },
  }, stagingError, ['api'])).toBe(true)
  expect(isResolvedAgentError({
    ...card,
    status: 'staging',
    prs: { staging: { api: 'https://github.com/example/api/pull/1' } },
  }, stagingError, ['api', 'web'])).toBe(false)

  const masterError = { status: 'erro' as const, stage: 'master-pr-task' }
  expect(isResolvedAgentError({ ...card, status: 'aguardando-deploy' }, masterError)).toBe(false)
  expect(isResolvedAgentError({
    ...card,
    status: 'aguardando-deploy',
    prs: { master: { api: 'https://github.com/example/api/pull/2' } },
  }, masterError, ['api'])).toBe(true)
  expect(isResolvedAgentError({
    ...card,
    status: 'aguardando-deploy',
    prs: { master: { api: 'https://github.com/example/api/pull/2' } },
  }, masterError, ['api', 'web'])).toBe(false)
  expect(isResolvedAgentError({ ...card, status: 'producao' }, masterError)).toBe(true)
})

test('perfis compartilham modelos e restringem os artefatos do planejamento', () => {
  expect(Object.values(FLOW_PROFILES).every((profile) => !('stages' in profile))).toBe(true)
  const planning = STAGES.find((stage) => stage.name === 'task-planning')
  expect(planning?.prompt?.({ title: 'Ajuste', description: '', status: 'planejando', flow: 'simples' })).toContain(
    'gere somente TASK-CHECKLIST.md',
  )
  expect(planning?.prompt?.({ title: 'Ajuste', description: '', status: 'planejando', flow: 'medio' })).toContain(
    'gere somente PLAN.md e TASK-CHECKLIST.md',
  )
  for (const flow of ['simples', 'medio', 'dificil'] as const) {
    const prompt = planning?.prompt?.({ title: 'Ajuste', description: '', status: 'planejando', flow })
    expect(prompt).toContain('inclua somente ações de implementação')
    expect(prompt).toContain('Não crie tasks de testes de qualquer tipo')
    expect(prompt).toContain('pertence exclusivamente à TEST-CHECKLIST.md')
  }
})

test('progresso de planejamento espera apenas os artefatos do fluxo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planning-flow-'))
  writeFileSync(join(dir, 'card.json'), JSON.stringify({ title: 'Ajuste', status: 'planejando', flow: 'simples' }))
  writeFileSync(join(dir, 'agent.json'), JSON.stringify({ pid: 1234, startedAt: '2026-01-01T00:00:00.000Z', stage: 'task-planning' }))
  writeFileSync(join(dir, 'task-planning.jsonl'), `${JSON.stringify({ type: 'system', session_id: 'simple-1' })}\n`)
  expect(readAgent(dir, () => true)).toMatchObject({
    phase: 'Criando tasks',
    progress: { done: 0, total: 1 },
  })
  writeFileSync(join(dir, 'TASK-CHECKLIST.md'), '- [ ] implementar')
  expect(readAgent(dir, () => true)).toMatchObject({
    phase: 'Finalizando',
    progress: { done: 1, total: 1 },
  })
})
