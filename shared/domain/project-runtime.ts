export type RuntimePolicy = 'strict' | 'same-major-fallback' | 'server-default'

export interface NodeRuntimeRequirement {
  source: 'override' | '.nvmrc' | '.node-version' | 'engines.node' | 'none'
  value?: string
  policy: RuntimePolicy
}

export interface ResolvedProjectRuntime {
  server: { version: string; execPath: string }
  cli?: { name: string; version?: string; execPath?: string }
  project?: { version: string; execPath: string }
  requirement: NodeRuntimeRequirement
  warning?: string
}

export interface ProjectCommand {
  id: string
  argv: string[]
  cwd: string
  timeoutMs: number
  environment?: Record<string, string>
  recordFile?: string
}

export interface EnvironmentDiagnostic {
  code: string
  message: string
  repo: string
  evidence?: Record<string, string | number | boolean>
}
