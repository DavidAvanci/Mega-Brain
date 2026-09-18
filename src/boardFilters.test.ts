import { describe, expect, it } from 'vitest'
import { matchesQuery, matchesState, needsAttention } from './boardFilters'
import type { Card } from './types'

function card(patch: Partial<Card> = {}): Card {
  return {
    id: 'ESTR-457',
    title: 'Suporte ao Banestes',
    description: 'Integração do dashboard',
    folder: '/workspace/banestes-web',
    createdAt: '2026-09-10T12:00:00.000Z',
    status: 'desenvolvendo',
    flow: 'dificil',
    ...patch,
  }
}

describe('board filters', () => {
  it('searches across id, title, description and repository path without case sensitivity', () => {
    expect(matchesQuery(card(), 'estr-457')).toBe(true)
    expect(matchesQuery(card(), 'BANESTES-WEB')).toBe(true)
    expect(matchesQuery(card(), 'inexistente')).toBe(false)
  })

  it('classifies agent, PR and error states independently', () => {
    expect(matchesState(card({ agents: [{ status: 'rodando' }] }), 'running')).toBe(true)
    expect(matchesState(card({ agents: [{ status: 'aguardando' }] }), 'waiting')).toBe(true)
    expect(matchesState(card({ agents: [{ status: 'erro' }] }), 'error')).toBe(true)
    expect(matchesState(card({ prs: { staging: { app: 'https://example.test/pr/1' } } }), 'pr')).toBe(true)
  })

  it('flags actionable states and old active work without treating backlog as stale', () => {
    const now = new Date('2026-09-13T12:00:01.000Z').getTime()
    expect(needsAttention(card(), now)).toBe(true)
    expect(needsAttention(card({ status: 'a-fazer' }), now)).toBe(false)
    expect(needsAttention(card({ createdAt: '2026-09-13T11:00:00.000Z', agents: [{ status: 'erro' }] }), now)).toBe(true)
  })
})
