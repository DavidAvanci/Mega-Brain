import { useEffect, useState } from 'react'
import { requestJson } from '@/shared/api/request-json'
import type { Repository, RepositoryMention } from '../../../shared/domain/repositories'

let cached: RepositoryMention[] | null = null
let pending: Promise<RepositoryMention[]> | null = null
let users = 0

async function fetchMentions(): Promise<RepositoryMention[]> {
  try {
    return await requestJson<RepositoryMention[]>('/api/repositories/mentions', 'Falha ao carregar repositórios')
  } catch {
    const repositories = await requestJson<Repository[]>('/api/repositories', 'Falha ao carregar repositórios')
    return repositories
      .filter((repository) => repository.active)
      .map(({ id, alias, displayName }) => ({ id, alias, displayName }))
  }
}

export function useRepositoryMentions(): { repositories: RepositoryMention[]; error: string | null; loading: boolean } {
  const [repositories, setRepositories] = useState<RepositoryMention[]>(cached ?? [])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(cached === null)
  useEffect(() => {
    users += 1
    let active = true
    pending ??= fetchMentions()
      .then((items) => (cached = items))
      .finally(() => {
        pending = null
      })
    void pending
      .then((items) => {
        if (active) {
          setRepositories(items)
          setLoading(false)
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setLoading(false)
        }
      })
    return () => {
      active = false
      users -= 1
      if (users === 0) cached = null
    }
  }, [])
  return { repositories, error, loading }
}
