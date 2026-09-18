import { describe, expect, test } from 'vitest'
import { groupOpenMasterPrs } from './deployPrs'
import type { Card } from './types'

function card(overrides: Partial<Card>): Card {
  return {
    id: 'CARD-1',
    title: 'Card padrão',
    description: '',
    folder: '/workspace/CARD-1',
    createdAt: '2026-09-11T00:00:00.000Z',
    status: 'aguardando-deploy',
    flow: 'dificil',
    ...overrides,
  }
}

describe('groupOpenMasterPrs', () => {
  test('agrupa PRs abertos de master por projeto e ordena projetos e cards', () => {
    const cards = [
      card({
        id: 'CARD-2',
        title: 'Zerar carrinho',
        prs: { master: { web: 'https://github.test/web/2', api: 'https://github.test/api/2' } },
        prStates: { 'https://github.test/web/2': 'open', 'https://github.test/api/2': 'open' },
      }),
      card({
        id: 'CARD-1',
        title: 'Adicionar produto',
        prs: { master: { web: 'https://github.test/web/1' } },
        prStates: { 'https://github.test/web/1': 'open' },
      }),
    ]

    expect(groupOpenMasterPrs(cards)).toEqual([
      {
        project: 'api',
        prs: [{ cardId: 'CARD-2', cardTitle: 'Zerar carrinho', url: 'https://github.test/api/2' }],
      },
      {
        project: 'web',
        prs: [
          { cardId: 'CARD-1', cardTitle: 'Adicionar produto', url: 'https://github.test/web/1' },
          { cardId: 'CARD-2', cardTitle: 'Zerar carrinho', url: 'https://github.test/web/2' },
        ],
      },
    ])
  })

  test('ignora outros status, ambientes e PRs que não estão abertos', () => {
    const cards = [
      card({
        prs: {
          staging: { api: 'https://github.test/api/staging' },
          master: {
            api: 'https://github.test/api/merged',
            web: 'https://github.test/web/unknown',
          },
        },
        prStates: {
          'https://github.test/api/staging': 'open',
          'https://github.test/api/merged': 'merged',
        },
      }),
      card({
        id: 'CARD-2',
        status: 'producao',
        prs: { master: { api: 'https://github.test/api/open' } },
        prStates: { 'https://github.test/api/open': 'open' },
      }),
    ]

    expect(groupOpenMasterPrs(cards)).toEqual([])
  })
})
