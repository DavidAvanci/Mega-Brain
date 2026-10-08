import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { ProcessChild, ProcessRunner } from '../process'
import { createWorkspaceService } from './service'
import { reviewPrompt } from './smart-diff-review'

afterEach(() => vi.unstubAllEnvs())

test('converts the old skill wording in saved Smart Diff prompts', () => {
  const legacy =
    'Esta skill faz só o que não pode ser determinístico, e o script `review.mjs` (na pasta desta skill; o diretório base vem no prompt de invocação, senão `~/.claude/skills/smart-diff-review/`) valida e monta o resultado.\nnode "<dir-da-skill>/review.mjs" prepare'
  const prompt = reviewPrompt('/card', [], legacy, '/app/smart-diff-review-cli.mjs')
  expect(prompt).toContain('O script de revisão incluído no Mega Brain valida e monta o resultado.')
  expect(prompt).toContain('node "/app/smart-diff-review-cli.mjs" prepare')
  expect(prompt).not.toMatch(/\.claude\/skills|dir-da-skill|Esta skill/)
})

test('opening diff runs Smart Diff against the GitHub default branch, reviews the report, and saves diff.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-smart-diff-'))
  const card = join(root, 'card')
  const repo = join(root, 'repo')
  mkdirSync(card)
  mkdirSync(repo)
  const smartDiffRoot = join(root, 'smart-diff')
  const smartDiffBin = join(smartDiffRoot, 'packages', 'cli', 'bin')
  mkdirSync(smartDiffBin, { recursive: true })
  writeFileSync(join(smartDiffBin, 'smart-diff.cjs'), '')
  vi.stubEnv('SMART_DIFF_DIR', smartDiffRoot)
  writeFileSync(join(repo, '.git'), 'gitdir: /fixture/.git/worktrees/card')
  symlinkSync(repo, join(card, 'api'), process.platform === 'win32' ? 'junction' : 'dir')
  const calls: { smartDiff: string[][]; agent: string[][] } = { smartDiff: [], agent: [] }
  const runner = {
    execFile(
      command: string,
      args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) {
      if (command === 'gh') return callback(null, 'main\n', '')
      if (command === 'git') return callback(null, '', '')
      calls.smartDiff.push([command, ...args])
      callback(null, JSON.stringify({ schemaVersion: 1, readingOrder: [] }), '')
    },
    spawn(command: string, args: readonly string[]) {
      calls.agent.push([command, ...args])
      const child = new EventEmitter() as ProcessChild
      queueMicrotask(() => {
        writeFileSync(
          join(
            card,
            '.smart-diff-review',
            createHash('sha256').update('api').digest('hex').slice(0, 16),
            'review.json',
          ),
          JSON.stringify({ schemaVersion: 2, sections: [], noise: [] }),
        )
        child.emit('close', 0)
      })
      return child
    },
  } as ProcessRunner
  const service = createWorkspaceService({ workspaceDir: root, executables: {} }, runner)
  const query = new URLSearchParams({ name: 'card' })

  expect(await service.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({
    status: 'running',
    started: true,
  })
  expect(await service.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({
    status: 'running',
    started: true,
  })
  expect(await service.handle('/diff', 'GET', query, undefined)).toMatchObject({
    status: 'running',
    steps: expect.arrayContaining(['Rodando a ferramenta Smart Diff em api']),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(calls.smartDiff).toHaveLength(1)
  expect(calls.smartDiff[0]).toContain('FETCH_HEAD...HEAD')
  expect(calls.agent).toHaveLength(1)
  const prompt = calls.agent[0].join(' ')
  expect(prompt).toContain('O script de revisão incluído no Mega Brain valida e monta o resultado.')
  expect(prompt).toContain('smart-diff-review-cli.mjs')
  expect(prompt).not.toMatch(/\.claude\/skills|dir-da-skill|Esta skill/)
  expect(existsSync(join(card, 'diff.json'))).toBe(true)
  expect(JSON.parse(readFileSync(join(card, 'diff.json'), 'utf8'))).toMatchObject({
    schemaVersion: 1,
    repositories: [{ name: 'api', review: { schemaVersion: 2 } }],
  })
  expect(await service.handle('/diff', 'GET', query, undefined)).toMatchObject({ status: 'ready', started: true })
  expect(await service.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({ status: 'ready' })
  expect(calls.smartDiff).toHaveLength(1)
  expect(await service.handle('/diff', 'POST', query, { name: 'card', regenerate: true })).toMatchObject({
    status: 'running',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls.smartDiff).toHaveLength(2)
  const restarted = createWorkspaceService({ workspaceDir: root, executables: {} }, runner)
  expect(await restarted.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({ status: 'ready' })
  expect(calls.smartDiff).toHaveLength(2)
})
