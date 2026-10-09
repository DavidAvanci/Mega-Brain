import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STAGE_SNAPSHOT_PREFIX = '.stage-snapshot-'

interface StageSnapshot {
  files: Record<string, string | null>
}

function snapshotFile(path: string, stageName: string): string {
  return join(path, `${STAGE_SNAPSHOT_PREFIX}${stageName}.json`)
}

/** Captures only artifacts owned by a stage, so reset never guesses at source files. */
export function captureStageSnapshot(path: string, stageName: string, ownedFiles: readonly string[]): void {
  const snapshot: StageSnapshot = {
    files: Object.fromEntries(
      ownedFiles.map((file) => [file, existsSync(join(path, file)) ? readFileSync(join(path, file), 'utf8') : null]),
    ),
  }
  writeFileSync(snapshotFile(path, stageName), `${JSON.stringify(snapshot)}\n`)
}

export function discardStageSnapshot(path: string, stageName: string): void {
  rmSync(snapshotFile(path, stageName), { force: true })
}

export function restoreStageSnapshot(path: string, stageName: string): void {
  const file = snapshotFile(path, stageName)
  if (existsSync(file)) {
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as StageSnapshot
    for (const [name, content] of Object.entries(snapshot.files ?? {})) {
      const target = join(path, name)
      if (content === null) rmSync(target, { force: true })
      else writeFileSync(target, content)
    }
    rmSync(file, { force: true })
    return
  }
}
