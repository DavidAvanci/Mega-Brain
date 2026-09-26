import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { repositoryMentionContext, resolveRepositoryMentions } from './mentions'

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
