import { expect, test } from 'vitest'
import { loadMegaBrainConfig } from './config'
import { detectEditors } from './editor-detection'

test('returns only editors whose executable exists and identifies WSL scope', () => {
  const config = loadMegaBrainConfig({
    homeDir: '/home/person',
    env: { MEGA_BRAIN_CURSOR_BIN: '/opt/cursor' },
  })
  const existing = new Set(['/opt/cursor', '/tools/code'])
  const result = detectEditors(config, {
    env: { PATH: '/tools', WSL_DISTRO_NAME: 'Ubuntu' },
    exists: (path) => existing.has(path),
  })

  expect(result.scope).toBe('Windows e WSL')
  expect(result.editors.slice(0, 2)).toEqual([
    { id: 'cursor', label: 'Cursor', command: '/opt/cursor', source: 'linux' },
    { id: 'vscode', label: 'VS Code', command: '/tools/code', source: 'linux' },
  ])
  expect(result.editors.some((editor) => editor.id === 'windsurf')).toBe(false)
})
