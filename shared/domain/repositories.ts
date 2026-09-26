export type RepositoryEnvironmentKey = 'local' | 'staging' | 'prod'
export type RepositoryDirtyAction = 'commit' | 'stash' | 'discard'

export interface RepositoryEnvironment {
  enabled: boolean
  migration?: { backend: boolean; command: string[]; workingDirectory: string }
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
  upstream?: string
  ahead?: number
  behind?: number
  remoteCheckedAt?: string
  migrationReady?: boolean
  source: 'local' | 'remote'
  state: 'up-to-date' | 'behind' | 'ahead' | 'diverged' | 'no-upstream' | 'unavailable' | 'remote-failed'
  error?: string
}

export interface RepositoryMigrationResult {
  state: 'idle' | 'running' | 'success' | 'failure'
  environment?: RepositoryEnvironmentKey
  command?: string[]
  workingDirectory?: string
  completedAt?: string
  output?: string
  error?: string
}

export interface RepositoryRegistryFile {
  version: 1
  repositories: Repository[]
}
