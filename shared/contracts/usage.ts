export interface UsageWindow {
  utilization: number
  resetsAt: string | null
}

export interface ClaudeUsage {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  fable: UsageWindow | null
}
