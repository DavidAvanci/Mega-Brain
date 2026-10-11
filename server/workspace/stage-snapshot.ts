import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASK_CHECKLIST_FILE } from '../../shared/domain/task-checklist'
import { convertLegacyChecklist } from '../../shared/storage/legacy-task-checklist'

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
    // Snapshots captured before the JSON migration must restore the current source of truth too.
    const legacyFile = 'TASK-CHECKLIST.md'
    if (Object.hasOwn(snapshot.files ?? {}, legacyFile)) {
      const legacy = snapshot.files[legacyFile]
      if (!Object.hasOwn(snapshot.files, TASK_CHECKLIST_FILE)) {
        snapshot.files[TASK_CHECKLIST_FILE] =
          legacy === null ? null : `${JSON.stringify(convertLegacyChecklist(legacy), null, 2)}\n`
      }
      if (legacy !== null && !existsSync(join(path, `${legacyFile}.bak`)))
        writeFileSync(join(path, `${legacyFile}.bak`), legacy)
      delete snapshot.files[legacyFile]
      rmSync(join(path, legacyFile), { force: true })
    }
    for (const [name, content] of Object.entries(snapshot.files ?? {})) {
      const target = join(path, name)
      if (content === null) rmSync(target, { force: true })
      else writeFileSync(target, content)
    }
    rmSync(file, { force: true })
    return
  }
}
