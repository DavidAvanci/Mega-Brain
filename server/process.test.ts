import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createChatService } from './chat/service'
import type { ProcessRunner } from './process'
import { repoDiff } from './workspace/worktree-inspector'

function fakeRunner(outputs: string[] = []): ProcessRunner & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    spawn(command, args) {
      calls.push([command, ...args])
      const child = new EventEmitter() as any
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => true
      child.unref = () => child
      return child
    },
    execFileSync(command, args) {
      calls.push([command, ...args])
      return outputs.shift() ?? ''
    },
    execFile(command, args, _options, callback) {
      calls.push([command, ...args])
      callback(null, outputs.shift() ?? '', '')
    },
  }
}

test('repoDiff builds git commands through a fake ProcessRunner', () => {
  const runner = fakeRunner(['origin/main\n', 'base\n', 'tracked\n', 'untracked.txt\0', 'new file\n'])
  expect(repoDiff('/fixture', 'git-fixture', runner)).toBe('tracked\nnew file\n')
  expect(runner.calls).toEqual([
    ['git-fixture', '-c', 'core.quotePath=false', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    ['git-fixture', '-c', 'core.quotePath=false', 'merge-base', 'origin/main', 'HEAD'],
    ['git-fixture', '-c', 'core.quotePath=false', 'diff', '--no-color', 'base'],
    ['git-fixture', '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'],
    ['git-fixture', '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-index', '/dev/null', 'untracked.txt'],
  ])
})

test('chat service streams through a fake ProcessRunner without invoking Claude', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-runner-'))
  const card = join(root, 'card')
  mkdirSync(card)
  const runner = fakeRunner()
  const service = createChatService(
    {
      workspaceDir: root,
      directories: {
        home: root,
        claudeHome: join(root, '.claude'),
        claudeProjects: join(root, 'projects'),
        claudeCredentials: join(root, '.claude', '.credentials.json'),
      },
      executables: { claude: 'claude-fixture' },
    },
    runner,
  )
  service.send('card', 'oi', () => {})
  expect(runner.calls[0][0]).toBe('claude-fixture')
  expect(runner.calls[0]).toContain('--output-format')
})
