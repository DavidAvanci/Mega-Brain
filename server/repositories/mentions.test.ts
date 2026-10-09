import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { repositoryMentionContext, repositoryMentions, resolveRepositoryMentions } from './mentions'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-mentions-'))
  const checkout = join(root, 'api')
  mkdirSync(join(checkout, '.git'), { recursive: true })
  const settingsFile = join(root, 'settings.json')
  writeFileSync(
    join(root, 'repositories.json'),
    JSON.stringify({
      version: 1,
      repositories: [
        { id: 'repo_1', alias: 'api', displayName: 'API', path: checkout, active: true },
        { id: 'repo_note', alias: 'nota', displayName: 'Nota repo', path: checkout, active: true },
        { id: 'repo_2', alias: 'old', displayName: 'Old', path: join(root, 'old'), active: false },
      ],
    }),
  )
  return { settingsFile, checkout }
}

test('resolves each active mention once with registered identity and validated path', () => {
  const { settingsFile, checkout } = fixture()
  expect(resolveRepositoryMentions('Use @api, depois @api. Ignore @unknown e @old.', settingsFile)).toEqual([
    { id: 'repo_1', alias: 'api', path: checkout },
  ])
  const context = repositoryMentionContext('Use @api', settingsFile)
  expect(context).toContain('"id":"repo_1"')
  expect(context).toContain(JSON.stringify({ id: 'repo_1', alias: 'api', path: checkout }))
})

test('keeps unknown mentions and ordinary at signs as plain text', () => {
  const { settingsFile } = fixture()
  const text = 'Contato a@api e @unknown'
  expect(repositoryMentionContext(text, settingsFile)).toBe(text)
})

test('knowledge mentions do not resolve as repository aliases', () => {
  const { settingsFile } = fixture()
  expect(resolveRepositoryMentions('@nota[page:abc-123] @nota[folder:folder-1]', settingsFile)).toEqual([])
  expect(resolveRepositoryMentions('@nota', settingsFile)).toHaveLength(1)
})

test('workspace resolve múltiplos checkouts ativos e elimina menções duplicadas', () => {
  const { settingsFile } = fixture()
  const file = join(settingsFile, '..', 'repositories.json')
  const catalog = JSON.parse(readFileSync(file, 'utf8'))
  for (const repo of catalog.repositories) repo.tags = ['workspace:takeat-core']
  writeFileSync(file, JSON.stringify(catalog))
  expect(repositoryMentions(catalog.repositories).filter(item => item.alias === 'takeat-core')).toHaveLength(1)
  expect(resolveRepositoryMentions('Use @takeat-core. e @api', settingsFile).map(repo => repo.alias)).toEqual(['api', 'nota'])
  expect(repositoryMentionContext('@takeat-core', settingsFile)).toContain('uma seção ## <alias> por repositório')
})
