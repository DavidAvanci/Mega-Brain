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
