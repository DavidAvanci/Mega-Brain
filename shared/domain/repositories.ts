export type RepositoryEnvironmentKey = 'local' | 'staging' | 'prod'
export type RepositoryDirtyAction = 'commit' | 'stash' | 'discard'

export interface RepositoryEnvironment {
  enabled: boolean
  startScript?: string
  port?: number
  url?: string
  envFile?: string
  companionRepositoryIds?: string[]
  targetBranch?: string
  githubEnvironment?: string
  variableSourceRefs?: string[]
  aws?: { accountId?: string; region?: string; resources?: string[] }
}

export interface Repository {
  id: string
  alias: string
  displayName: string
  path: string
  active: boolean
  tags: string[]
  githubUrl?: string
  environments: Record<RepositoryEnvironmentKey, RepositoryEnvironment>
}

export interface RepositoryStatus {
  available: boolean
  path: string
  branch?: string
  dirty?: boolean
  origin?: string
  checkedAt: string
  error?: string
}

export interface RepositoryRegistryFile {
  version: 1
  repositories: Repository[]
}
