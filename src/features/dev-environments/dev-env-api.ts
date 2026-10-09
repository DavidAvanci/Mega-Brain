import type { DevEnvPreview, DevEnvStartOptions } from '../../../shared/domain/dev-environments'
import { requestJson } from '@/shared/api/request-json'
import { refresh } from '@/features/cards/model/card-commands'

export const previewDevEnv = (name: string): Promise<DevEnvPreview> =>
  requestJson('/api/workspace/dev-env/preview', 'Falha ao preparar a prévia do ambiente dev', {
    method: 'POST',
    body: { name },
  })

export async function startConfiguredDevEnv(name: string, configuration: DevEnvStartOptions): Promise<void> {
  await requestJson('/api/workspace/dev-env', 'Falha ao iniciar o ambiente dev', {
    method: 'POST',
    body: { name, configuration },
  })
  await refresh()
}
