import { expect, test } from 'vitest'
import { assertSafeTestFetch, assertSafeTestProcess, assertSafeTestWorkspace, isSafeTestPath } from './safety-guard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createWorkspaceService } from '../server/workspace/service'

test('allows a fixture workspace and Git rooted in the temporary directory', () => {
  const workspace = join(tmpdir(), 'mega-brain-guard-fixture')
  expect(isSafeTestPath(workspace)).toBe(true)
  expect(() => assertSafeTestWorkspace(workspace)).not.toThrow()
  expect(() => assertSafeTestProcess('git', ['-C', workspace, 'status'])).not.toThrow()
})

test('fails closed for a real workspace, Claude, shell, unsafe Git and Jira', () => {
  expect(() => assertSafeTestWorkspace('/home/david/real-workspace')).toThrow('TEST SAFETY')
  expect(() => assertSafeTestProcess('claude', ['-p', 'do work'])).toThrow('refused to spawn Claude')
  expect(() => assertSafeTestProcess('sh', ['-lc', 'claude -p x'])).toThrow('unsafe executable')
  expect(() => assertSafeTestProcess('git', ['status'], { cwd: '/home/david/real-workspace' })).toThrow(
    'temporary test directory',
  )
  expect(() => assertSafeTestFetch('https://example.atlassian.net/rest/api/3/search')).toThrow(
    'refused real Jira fetch',
  )
})

test('the installed setup guards block process, workspace and fetch boundaries', async () => {
  expect(() => execFileSync('claude', ['--version'])).toThrow('refused to spawn Claude')
  const workspace = createWorkspaceService({ workspaceDir: '/home/david/real-workspace', executables: {} })
  await expect(workspace.handle('/', 'GET', new URLSearchParams(), undefined)).rejects.toThrow(
    'workspace must be inside',
  )
  expect(() => fetch('https://example.atlassian.net/rest/api/3/search')).toThrow('refused real Jira fetch')
})
