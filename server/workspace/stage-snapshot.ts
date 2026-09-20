import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const STAGE_SNAPSHOT_PREFIX = '.stage-snapshot-'

interface StageSnapshot {
  files: Record<string, string | null>
  screenshotFiles?: string[]
}

function snapshotFile(path: string, stageName: string): string {
  return join(path, `${STAGE_SNAPSHOT_PREFIX}${stageName}.json`)
}

function relativeFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) files.push(relative(root, full))
    }
  }
  visit(root)
  return files
}

/** Captures only artifacts owned by a stage, so reset never guesses at source files. */
export function captureStageSnapshot(path: string, stageName: string, ownedFiles: readonly string[]): void {
  const snapshot: StageSnapshot = {
    files: Object.fromEntries(
      ownedFiles.map((file) => [file, existsSync(join(path, file)) ? readFileSync(join(path, file), 'utf8') : null]),
    ),
    screenshotFiles: stageName === 'run-test-checklist' ? relativeFiles(join(path, 'screenshots')) : undefined,
  }
  writeFileSync(snapshotFile(path, stageName), `${JSON.stringify(snapshot)}\n`)
}

export function discardStageSnapshot(path: string, stageName: string): void {
  rmSync(snapshotFile(path, stageName), { force: true })
}

export function restoreStageSnapshot(path: string, stageName: string, startedAt?: string): void {
  const file = snapshotFile(path, stageName)
  if (existsSync(file)) {
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as StageSnapshot
    for (const [name, content] of Object.entries(snapshot.files ?? {})) {
      const target = join(path, name)
      if (content === null) rmSync(target, { force: true })
      else writeFileSync(target, content)
    }
    if (stageName === 'run-test-checklist') {
      const screenshots = join(path, 'screenshots')
      const previous = new Set(snapshot.screenshotFiles ?? [])
      for (const screenshot of relativeFiles(screenshots)) {
        if (!previous.has(screenshot)) rmSync(join(screenshots, screenshot), { force: true })
      }
    }
    rmSync(file, { force: true })
    return
  }

  // Older runs had no snapshot. Only remove test captures attributable to that run.
  if (stageName !== 'run-test-checklist' || !startedAt) return
  const since = Date.parse(startedAt)
  const screenshots = join(path, 'screenshots')
  for (const screenshot of relativeFiles(screenshots)) {
    const target = join(screenshots, screenshot)
    if (Number.isFinite(since) && statSync(target).mtimeMs >= since) rmSync(target, { force: true })
  }
}
