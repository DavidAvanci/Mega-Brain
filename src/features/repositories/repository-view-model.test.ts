import { describe, expect, it } from 'vitest'
import type { RepositoryStatus } from '../../../shared/domain/repositories'
import { matchesRepositoryFilter, repositoryPrimaryAction, repositoryStatusLabel } from './repository-view-model'

const status = (
  state: RepositoryStatus['state'],
  source: RepositoryStatus['source'] = 'remote',
  overrides: Partial<RepositoryStatus> = {},
): RepositoryStatus => ({
  available: state !== 'unavailable',
  path: '/repo',
  branch: 'main',
  checkedAt: '2026-09-25T00:00:00Z',
  source,
  state,
  ...overrides,
})

describe('repository row states', () => {
  it('offers checkout update only for a verified, clean checkout behind the remote', () => {
    expect(repositoryPrimaryAction(status('behind'))).toBe('pull')
    expect(repositoryPrimaryAction(status('behind', 'local'))).toBe('verify')
    expect(repositoryPrimaryAction(status('behind', 'remote', { dirty: true }))).toBeNull()
  })

  it('distinguishes a remote error, missing checkout and missing upstream', () => {
    expect(repositoryStatusLabel(status('remote-failed'))).toBe('Erro ao verificar remoto')
    expect(repositoryPrimaryAction(status('remote-failed'))).toBe('verify')
    expect(repositoryStatusLabel(status('unavailable'))).toBe('Checkout indisponível')
    expect(repositoryPrimaryAction(status('unavailable'))).toBe('settings')
    expect(repositoryPrimaryAction(status('no-upstream'))).toBe('settings')
  })

  it('filters by state without treating a loading row as unavailable', () => {
    expect(matchesRepositoryFilter(undefined, 'unavailable')).toBe(false)
    expect(matchesRepositoryFilter(status('unavailable'), 'unavailable')).toBe(true)
    expect(matchesRepositoryFilter(status('up-to-date', 'local'), 'unverified')).toBe(true)
    expect(matchesRepositoryFilter(status('up-to-date'), 'unverified')).toBe(false)
    expect(matchesRepositoryFilter(status('behind'), 'attention')).toBe(true)
  })
})
