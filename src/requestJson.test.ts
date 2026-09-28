import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapWebApiClient } from './shared/api/api-client'
import { requestJson } from './shared/api/request-json'

afterEach(() => bootstrapWebApiClient())

describe('requestJson errors', () => {
  it('explains a transport failure in the context of the attempted action', async () => {
    bootstrapWebApiClient(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(
      requestJson('/api/repositories/env', 'Falha ao salvar variáveis', {
        method: 'PUT',
        body: { environment: 'local', variables: { EXAMPLE: 'value' } },
      }),
    ).rejects.toThrow('Falha ao salvar variáveis: não foi possível conectar ao backend')
  })

  it('preserves a validation error returned by the backend', async () => {
    bootstrapWebApiClient(
      vi.fn().mockResolvedValue(
        new Response('{"error":"Valor inválido para EXAMPLE"}', {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(
      requestJson('/api/repositories/env', 'Falha ao salvar variáveis', {
        method: 'PUT',
        body: { environment: 'local', variables: { EXAMPLE: 'value' } },
      }),
    ).rejects.toThrow('Valor inválido para EXAMPLE')
  })
})
