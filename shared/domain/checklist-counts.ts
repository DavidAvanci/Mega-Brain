export type TaskState = 'open' | 'done' | 'skipped' | 'failed'

export interface TaskCounts {
  total: number
  done: number
  skipped: number
  failed: number
}

export const TASK_STATES: Record<string, TaskState> = { ' ': 'open', x: 'done', X: 'done', '-': 'skipped', '!': 'failed' }
export const TASK_LINE = /^(\s*[-*] )\[([ xX\-!])\] /

export function countTasks(text: string): TaskCounts {
  const counts: TaskCounts = { total: 0, done: 0, skipped: 0, failed: 0 }
  for (const line of text.split('\n')) {
    const match = TASK_LINE.exec(line)
    if (!match || match[1].length > 2) continue
    counts.total++
    const state = TASK_STATES[match[2]]
    if (state !== 'open') counts[state]++
  }
  return counts
}
