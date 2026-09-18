import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createChatService } from '../chat/service'
import { createWorkspaceService } from './service'
import { createWorkspacePathResolver } from './path'

const temporaryRoots: string[] = []

function fixture(): { root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), 'mega-brain-path-test-'))
  temporaryRoots.push(base)
  const root = join(base, 'workspace')
  const outside = join(base, 'outside')
  mkdirSync(join(root, 'valid-card'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  return { root, outside }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('workspace card path validation', () => {
  test('returns the canonical path for a valid direct child', () => {
    const { root } = fixture()
    const resolved = createWorkspacePathResolver(root).resolveCardFolder('valid-card')
    expect(resolved).toEqual({ name: 'valid-card', path: join(root, 'valid-card') })
  })

  test.each(['..', '../outside', 'valid-card/child', 'valid-card\\child', 'valid..card', 'missing-card'])(
    'rejects traversal, separators, and nonexistent card %j',
    (name) => {
      const { root } = fixture()
      expect(() => createWorkspacePathResolver(root).resolveCardFolder(name)).toThrow(`Pasta não encontrada: ${name}`)
    },
  )

  test('rejects a card symlink that resolves outside the configured workspace', () => {
    const { root, outside } = fixture()
    symlinkSync(outside, join(root, 'escaped-card'), 'dir')
    expect(() => createWorkspacePathResolver(root).resolveCardFolder('escaped-card')).toThrow('Pasta não encontrada: escaped-card')
  })

  test('workspace and chat services share the symlink-escape guard', async () => {
    const { root, outside } = fixture()
    symlinkSync(outside, join(root, 'escaped-card'), 'dir')
    const workspace = createWorkspaceService({ workspaceDir: root, executables: {} })
    const chat = createChatService({
      workspaceDir: root,
      executables: {},
      directories: {
        home: root,
        claudeHome: join(root, '.claude'),
        claudeProjects: join(root, 'claude-projects'),
        claudeCredentials: join(root, '.claude', '.credentials.json'),
      },
    })

    await expect(workspace.handle('/detail', 'GET', new URLSearchParams({ name: 'escaped-card' }), undefined))
      .rejects.toThrow('Pasta não encontrada: escaped-card')
    await expect(chat.history('escaped-card')).rejects.toThrow('Pasta não encontrada: escaped-card')
  })
})
