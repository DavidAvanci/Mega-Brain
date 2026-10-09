export interface UsageWindow {
  utilization: number
  resetsAt: string | null
}

export interface ClaudeUsage {
  codexProfileId?: string
  codexProfileName?: string
  unavailableReason?: string
  stale?: boolean
  updatedAt?: string | null
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  fable: UsageWindow | null
}
