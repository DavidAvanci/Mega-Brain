export interface UsageWindow {
  utilization: number
  resetsAt: string | null
}

export interface ClaudeUsage {
  stale?: boolean
  updatedAt?: string | null
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  fable: UsageWindow | null
}
