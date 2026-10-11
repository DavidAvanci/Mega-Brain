import { existsSync, linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { parseTaskChecklist, TASK_CHECKLIST_FILE, type TaskChecklist } from '../domain/task-checklist.ts'
import { convertLegacyChecklist } from './legacy-task-checklist.ts'

/** Writes a fully validated document through a sibling file, never exposing partial JSON to readers. */
export function writeTaskChecklist(file: string, checklist: TaskChecklist): void {
  persistTaskChecklist(file, checklist)
}

function persistTaskChecklist(file: string, checklist: TaskChecklist, createOnly = false): void {
  const document = parseTaskChecklist(checklist)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' })
    if (createOnly) {
      try {
        linkSync(temporary, file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    } else renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/** Old cards are converted once; a present but invalid JSON is never replaced by stale Markdown. */
export function readTaskChecklist(directory: string): TaskChecklist | null {
  const file = join(directory, TASK_CHECKLIST_FILE)
  if (existsSync(file)) return parseTaskChecklist(readFileSync(file, 'utf8'))
  const legacy = join(directory, 'TASK-CHECKLIST.md')
  if (!existsSync(legacy)) return null
  let markdown: string
  try {
    markdown = readFileSync(legacy, 'utf8')
  } catch (error) {
    // Another reader may have published the JSON and archived the Markdown meanwhile.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && existsSync(file))
      return parseTaskChecklist(readFileSync(file, 'utf8'))
    throw error
  }
  const document = convertLegacyChecklist(markdown)
  // Publishing without replacement prevents two processes from migrating over an updated JSON.
  persistTaskChecklist(file, document, true)
  // Preserve the original for recovery, outside the set of active card artifacts.
  if (!existsSync(`${legacy}.bak`)) {
    try {
      renameSync(legacy, `${legacy}.bak`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return parseTaskChecklist(readFileSync(file, 'utf8'))
}
