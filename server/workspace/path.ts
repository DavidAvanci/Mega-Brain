import { existsSync, realpathSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

/**
 * Resolves a card directory without allowing an API caller to escape the
 * configured workspace.  Callers must use the returned canonical path rather
 * than joining the user supplied name themselves.
 */
export interface WorkspacePathResolver {
  readonly root: string
  resolveCardFolder(value: unknown): { name: string; path: string }
}

function isChildOf(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return (
    path !== '' &&
    !path.startsWith(`..${sep}`) &&
    path !== '..' &&
    !path.includes('\0') &&
    !resolve(root, path).startsWith(`..${sep}`)
  )
}

function validCardName(name: string): boolean {
  // Keep the historical card-name contract, while explicitly excluding path
  // components such as ../ and names that merely contain a traversal segment.
  return /^[\w.-]+$/.test(name) && !name.includes('..')
}

export function createWorkspacePathResolver(workspaceDir: string): WorkspacePathResolver {
  const configuredRoot = resolve(workspaceDir)

  return {
    get root() {
      // Resolving the root at use time also handles a configured workspace
      // reached through a symlink, without requiring chat to create it.
      return realpathSync(configuredRoot)
    },
    resolveCardFolder(value) {
      const name = String(value ?? '')
      if (!validCardName(name)) throw new Error(`Pasta não encontrada: ${name}`)

      const root = realpathSync(configuredRoot)
      const requested = resolve(root, name)
      if (!isChildOf(root, requested) || !existsSync(requested)) {
        throw new Error(`Pasta não encontrada: ${name}`)
      }

      let path: string
      try {
        path = realpathSync(requested)
      } catch {
        throw new Error(`Pasta não encontrada: ${name}`)
      }
      if (!isChildOf(root, path) || !statSync(path).isDirectory()) {
        throw new Error(`Pasta não encontrada: ${name}`)
      }
      return { name, path }
    },
  }
}
