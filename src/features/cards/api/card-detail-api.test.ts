import { beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_PROMPTS, type MegaBrainSettings } from '../../../../shared/domain/settings'
import { requestJson } from '@/shared/api/request-json'
import { saveMegaBrainSettings } from './card-detail-api'

vi.mock('@/shared/api/request-json', () => ({ requestJson: vi.fn() }))
beforeEach(() => vi.resetAllMocks())

const settings = (jevEnabled: boolean) =>
  ({ general: { jevEnabled }, prompts: { ...DEFAULT_PROMPTS } }) as MegaBrainSettings

test.each([true, false])('accepts confirmed Jev setting %s', async (enabled) => {
  const input = settings(enabled)
  vi.mocked(requestJson).mockResolvedValue(input)
  expect(await saveMegaBrainSettings(input)).toEqual(input)
  expect(requestJson).toHaveBeenCalledWith('/api/workspace/settings', 'Falha ao salvar configurações', {
    method: 'POST',
    body: input,
  })
})

test.each([{ general: { layaEnabled: false } }, settings(false)])(
  'rejects an old backend or an unpersisted Jev setting',
  async (response) => {
    vi.mocked(requestJson).mockResolvedValue(response)
    await expect(saveMegaBrainSettings(settings(true))).rejects.toThrow('O backend não confirmou a configuração do Jev')
  },
)

test('accepts restored default prompts after the backend trims their surrounding whitespace', async () => {
  const input = settings(false)
  expect(input.prompts.taskPlanning.endsWith('\n')).toBe(true)
  const saved = {
    ...input,
    prompts: Object.fromEntries(Object.entries(input.prompts).map(([key, prompt]) => [key, prompt.trim()])),
  }
  vi.mocked(requestJson).mockResolvedValue(saved)
  expect(await saveMegaBrainSettings(input)).toEqual(saved)
})

test('accepts custom prompts after trimming without changing their internal formatting', async () => {
  const input = settings(false)
  input.prompts.taskPlanning = ' \n# Planejamento\n\n  Preserve a indentação.\n\n '
  const saved = { ...input, prompts: { ...input.prompts, taskPlanning: input.prompts.taskPlanning.trim() } }
  vi.mocked(requestJson).mockResolvedValue(saved)
  expect(await saveMegaBrainSettings(input)).toEqual(saved)
})

test.each([
  undefined,
  { ...DEFAULT_PROMPTS, taskPlanning: undefined },
  { ...DEFAULT_PROMPTS, taskPlanning: 'Outro prompt' },
  { ...DEFAULT_PROMPTS, taskPlanning: DEFAULT_PROMPTS.taskPlanning.replace('\n\n', '\n') },
])('rejects missing or changed prompt content returned by the backend', async (prompts) => {
  vi.mocked(requestJson).mockResolvedValue({ ...settings(false), prompts })
  await expect(saveMegaBrainSettings(settings(false))).rejects.toThrow('O backend não confirmou os prompts')
})
