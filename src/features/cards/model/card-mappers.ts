import type { AgentInfo, DevEnvInfo } from '../../../../shared/domain/agents'
import {
  STATUSES,
  type Card,
  type FlowLevel,
  type PrLinks,
  type PrState,
  type Status,
} from '../../../../shared/domain/cards'

export interface WorkspaceFolder {
  name: string
  path: string
  createdAt: string
  updatedAt?: string
  title: string
  description: string
  status: string
  flow?: FlowLevel
  agents?: AgentInfo[] | null
  devEnv?: DevEnvInfo | null
  prs?: PrLinks | null
  prStates?: Record<string, PrState> | null
}

function statusOf(folder: WorkspaceFolder): Status {
  return STATUSES.includes(folder.status as Status) ? (folder.status as Status) : 'a-fazer'
}

export function toCards(folders: WorkspaceFolder[], jiraStatuses: Readonly<Record<string, string>>): Card[] {
  return folders.map((folder) => ({
    id: folder.name,
    title: folder.title,
    description: folder.description,
    folder: folder.path,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    status: statusOf(folder),
    flow: folder.flow ?? 'dificil',
    jiraStatus: jiraStatuses[folder.name.toUpperCase()],
    agents: folder.agents ?? undefined,
    devEnv: folder.devEnv ?? undefined,
    prs: folder.prs ?? undefined,
    prStates: folder.prStates ?? undefined,
  }))
}
