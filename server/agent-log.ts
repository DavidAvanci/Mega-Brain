import { closeSync, openSync, readSync, statSync } from 'node:fs'

/** Read only the tail of an append-only agent transcript without loading it all. */
export function readTail(file: string, bytes: number): string {
  const size = statSync(file).size
  const start = Math.max(0, size - bytes)
  const buffer = Buffer.alloc(size - start)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, start)
  } finally {
    closeSync(fd)
  }
  return buffer.toString('utf8')
}

export function summarizeAgentInput(input: Record<string, unknown> = {}): string {
  const value = input.description ?? input.file_path ?? input.pattern ?? input.command ?? input.prompt ?? ''
  return String(value).slice(0, 120)
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

export function parseJsonRecord(line: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(line))
  } catch {
    return undefined
  }
}

export function toolUse(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const content = record(event.message)?.content
  return Array.isArray(content) ? content.map(record).find((item) => item?.type === 'tool_use') : undefined
}
