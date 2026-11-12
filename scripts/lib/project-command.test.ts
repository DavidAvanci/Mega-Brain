import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProjectCommand } from './project-command.ts'

const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('runProjectCommand', () => {
  it('runs argv with the selected node and captures runtime evidence', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mega-command-'))
    directories.push(cwd)
    const result = await runProjectCommand(
      { id: 'probe', cwd, argv: [process.execPath, '-p', 'process.version + " " + process.execPath'], timeoutMs: 5000 },
      { execPath: process.execPath, version: process.version.slice(1) },
    )
    expect(result.status).toBe('passed')
    expect(result.stdout).toContain(process.version)
    expect(result.runtime?.execPath).toBe(process.execPath)
  })

  it('stops a command after timeout', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mega-command-timeout-'))
    directories.push(cwd)
    const result = await runProjectCommand(
      { id: 'timeout', cwd, argv: [process.execPath, '-e', 'setTimeout(()=>{},10000)'], timeoutMs: 50 },
      { execPath: process.execPath },
    )
    expect(result.status).toBe('timeout')
  })
})
