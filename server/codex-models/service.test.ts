import { ChildProcess } from 'node:child_process'
import { PassThrough, Writable } from 'node:stream'
import { expect, test, vi } from 'vitest'
import type { ProcessRunner } from '../process'
import { createCodexModelsService, parseCodexModels } from './service'
import { supportedEfforts } from '../../shared/domain/codex-models'

const entry = (model = 'gpt-6.1-sol', efforts = ['low', 'medium', 'high', 'ultra']) => ({
  model,
  displayName: model,
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })),
  defaultReasoningEffort: 'medium',
  isDefault: true,
})

test('model discovery filters hidden and malformed entries, keeps new models and supported efforts', () => {
  const models = parseCodexModels({
    data: [
      entry(),
      { ...entry('hidden'), hidden: true },
      entry('new-model', ['high', 'unknown', 'high']),
      entry('invalid', []),
      { model: 42 },
    ],
  })
  expect(models.map((model) => model.id)).toEqual(['gpt-6.1-sol', 'new-model'])
  expect(models[0].label).toBe('GPT-6.1 Sol')
  expect(models[1].supportedEfforts).toEqual(['high'])
  expect(models[1].defaultEffort).toBe('high')
})

function fakeRunner(reply: (packet: Record<string, unknown>, emit: (value: unknown) => void) => void) {
  const child = new ChildProcess()
  child.stdout = new PassThrough()
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const packet = JSON.parse(String(chunk)) as Record<string, unknown>
      queueMicrotask(() => reply(packet, (value) => child.stdout!.emit('data', `${JSON.stringify(value)}\n`)))
      callback()
    },
  })
  const kill = vi.spyOn(child, 'kill').mockReturnValue(true)
  const spawn = vi.fn(() => child)
  const runner: ProcessRunner = {
    spawn,
    execFileSync: () => '',
    execFile: (_command, _args, _options, callback) => callback(null, '', ''),
  }
  return { runner, spawn, kill }
}

test('queries all pages, respects configured automatic model, deduplicates concurrent reads and cleans up', async () => {
  const packets: Record<string, unknown>[] = []
  const fake = fakeRunner((packet, emit) => {
    packets.push(packet)
    if (packet.method === 'initialize') emit({ id: 0, result: {} })
    if (packet.method === 'model/list') {
      emit(
        packet.id === 1
          ? { id: 1, result: { data: [entry()], nextCursor: 'next' } }
          : { id: 2, result: { data: [entry('gpt-6-luna', ['low', 'medium', 'high', 'max'])] } },
      )
    }
    if (packet.method === 'config/read')
      emit({ id: 'config', result: { config: { model: 'gpt-6-luna', secret: 'never expose' } } })
  })
  const service = createCodexModelsService('codex-custom', '/profile', fake.runner)
  const [first, second] = await Promise.all([service.getModels(), service.getModels()])
  expect(first).toEqual(second)
  expect(first.source).toBe('codex')
  expect(first.models).toHaveLength(2)
  expect(first.defaultModelId).toBe('gpt-6-luna')
  expect(supportedEfforts('chatgpt', 'default', first)).not.toContain('ultra')
  expect(JSON.stringify(first)).not.toContain('secret')
  expect(fake.spawn).toHaveBeenCalledTimes(1)
  expect(fake.spawn).toHaveBeenCalledWith(
    'codex-custom',
    ['app-server'],
    expect.objectContaining({ env: expect.objectContaining({ CODEX_HOME: '/profile' }) }),
  )
  expect(packets.some((packet) => packet.method === 'turn/start')).toBe(false)
  expect(fake.kill).toHaveBeenCalledWith('SIGTERM')
  expect(await service.getModels()).toEqual(first)
  expect(fake.spawn).toHaveBeenCalledTimes(1)
})

test('provider errors and timeouts expose a marked fallback and terminate only the helper', async () => {
  const failure = fakeRunner((_packet, emit) => emit({ id: 0, error: { code: -1 } }))
  expect((await createCodexModelsService('codex', undefined, failure.runner).getModels()).source).toBe('fallback')
  expect(failure.kill).toHaveBeenCalledWith('SIGTERM')
  const timeout = fakeRunner(() => {})
  const catalog = await createCodexModelsService('codex', undefined, timeout.runner, undefined, 10).getModels()
  expect(catalog.source).toBe('fallback')
  expect(catalog.models.some((model) => model.id === 'gpt-6.1-sol')).toBe(true)
  expect(timeout.kill).toHaveBeenCalledWith('SIGTERM')
})
