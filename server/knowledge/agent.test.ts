import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { knowledgeAgentEnvironment } from './agent'
import { knowledgeFile, knowledgeService } from './service'
import { loadMegaBrainConfig } from '../config'
import { createServerRuntime } from '../runtime'
import { createStandaloneServer, type StandaloneServer } from '../main'
const roots: string[] = []
const servers: StandaloneServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})
test.each(['Codex', 'Claude'])(
  'packaged Node adapter lets %s search/read/create/update but cannot access general API routes',
  async (name) => {
    const root = mkdtempSync(join(tmpdir(), 'mega-knowledge-agent-'))
    roots.push(root)
    const config = loadMegaBrainConfig({
      env: { MEGA_BRAIN_SETTINGS_FILE: join(root, 'settings.json'), MEGA_BRAIN_WORKSPACE_DIR: join(root, 'workspace') },
      homeDir: root,
    })
    const runtime = createServerRuntime({ config })
    const bearer = 'b'.repeat(43)
    const server = createStandaloneServer({ config, runtime, listen: { port: 0 }, sessionToken: bearer })
    servers.push(server)
    await server.start()
    const url = `http://127.0.0.1:${server.address().port}`
    // A normal app request establishes the actual ephemeral listener address.
    expect((await fetch(url + '/api/knowledge', { headers: { Authorization: `Bearer ${bearer}` } })).status).toBe(200)
    const env = knowledgeAgentEnvironment(config.preferences.settingsFile, {
      kind: 'agent',
      name,
      taskId: 'MB-001',
      sessionId: 'run-1',
    })
    const run = (args: string[]) =>
      new Promise<unknown>((resolve, reject) => {
        execFile(
          process.execPath,
          [env.MEGA_BRAIN_KNOWLEDGE_CLI!, ...args],
          { cwd: root, env: { ...process.env, ...env } },
          (error, stdout) => {
            if (error) return reject(error)
            resolve(JSON.parse(stdout))
          },
        )
      })
    const input = join(root, 'input.json')
    writeFileSync(input, JSON.stringify({ title: 'Contrato', markdown: '# Regra\n\n- Autenticação local' }))
    await run(['create', input])
    const service = knowledgeService(knowledgeFile(config.preferences.settingsFile))
    const page = service.list().pages[0]
    expect(page.actor).toMatchObject({ name, taskId: 'MB-001', sessionId: 'run-1' })
    expect(await run(['search', 'Autenticação'])).toMatchObject([{ id: page.id }])
    expect(await run(['read', page.id])).toMatchObject({ revision: 1 })
    writeFileSync(input, JSON.stringify({ title: 'Contrato atualizado', markdown: 'Texto novo', baseRevision: 1 }))
    await run(['update', page.id, input])
    expect(service.get(page.id).revision).toBe(2)
    const scoped = { 'x-mega-knowledge-capability': env.MEGA_BRAIN_KNOWLEDGE_CAPABILITY! }
    expect(
      (
        await fetch(url + '/api/knowledge/trash', {
          method: 'POST',
          headers: { ...scoped, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: { kind: 'page', id: page.id } }),
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await fetch(url + '/api/knowledge/agent', {
          method: 'POST',
          headers: { ...scoped, Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
          body: '{"action":"list"}',
        })
      ).status,
    ).toBe(403)
  },
)
