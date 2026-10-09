import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { readDevEnvLogs, redactDevEnvOutput } from './dev-env-logs'
import { devEnvDiagnosis } from '../../../shared/domain/dev-environments'

const roots: string[] = []
function card() {
  const root = mkdtempSync(join(tmpdir(), 'mega-dev-env-logs-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('logs inexistentes retornam vazio e arquivos externos e links não podem ser lidos', () => {
  const root = card()
  expect(readDevEnvLogs(root)).toEqual({ files: [], file: null, content: '', truncated: false })
  mkdirSync(join(root, '.dev-env'))
  writeFileSync(join(root, 'external.log'), 'private')
  symlinkSync(join(root, 'external.log'), join(root, '.dev-env/link.log'))
  writeFileSync(join(root, '.dev-env/api.log'), 'running')
  expect(readDevEnvLogs(root).files).toEqual(['api.log'])
  expect(() => readDevEnvLogs(root, '../external.log')).toThrow('Log indisponível')
  expect(() => readDevEnvLogs(root, 'link.log')).toThrow('Log indisponível')
})

test('limita logs ao final do arquivo, remove ANSI e oculta credenciais', () => {
  const root = card()
  mkdirSync(join(root, '.dev-env'))
  writeFileSync(
    join(root, '.dev-env/api.log'),
    'x'.repeat(70_000) +
      '\n\u001b[31mDB_PASSWORD=hidden-password\u001b[0m\nAuthorization: Bearer hidden-token\npostgres://user:password@localhost/db\n{"api_key":"hidden-key"}\nMEGA_BRAIN_DEV_ENV_CAPABILITY=hidden-capability\nready',
  )
  const logs = readDevEnvLogs(root)
  expect(logs.truncated).toBe(true)
  expect(logs.content.length).toBeLessThanOrEqual(65536)
  expect(logs.content).toContain('ready')
  for (const secret of [
    'hidden-password',
    'hidden-token',
    'user:password',
    'hidden-key',
    'hidden-capability',
    '\u001b',
  ])
    expect(logs.content).not.toContain(secret)
  expect(redactDevEnvOutput('PORT=3333\nready')).toBe('PORT=3333\nready')
})

test('recusa diretório de logs redirecionado por symlink', () => {
  const root = card()
  const elsewhere = card()
  symlinkSync(elsewhere, join(root, '.dev-env'))
  expect(() => readDevEnvLogs(root)).toThrow('Diretório de logs inválido')
})

test('oculta credenciais em corpos JSON serializados dentro de logs JSON', () => {
  const output = JSON.stringify({
    config: { data: JSON.stringify({ token: 'private-fixture-token', password: 'private-fixture-password' }) },
  })
  const redacted = redactDevEnvOutput(output)
  expect(redacted).not.toContain('private-fixture-token')
  expect(redacted).not.toContain('private-fixture-password')
})

test('timeout identifica projeto e porta e orienta a consultar logs', () => {
  const diagnosis = devEnvDiagnosis({
    status: 'erro',
    failure: { repo: 'api-garcom-digital', phase: 'Iniciando API' },
    error: 'Timeout esperando a porta 3333 responder',
    apps: [{ repo: 'api-garcom-digital', source: 'worktree', kind: 'backend', port: 3333, status: 'erro' }],
  })
  expect(diagnosis.title).toBe('api-garcom-digital não respondeu na porta 3333')
  expect(diagnosis.nextStep).toContain('logs')
  expect(devEnvDiagnosis({ status: 'erro', error: 'Docker: não consegui subir banco', apps: [] }).nextStep).toContain(
    'desative',
  )
})
