import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { JIRA_KEY_PATTERN } from '../jira/service'
import { claimNextCardFolder, formatCardId } from './card-id'
import { createCard } from './service'

const tempRoot = () => mkdtempSync(join(tmpdir(), 'mega-brain-card-id-'))

test('formatCardId pads to three digits and grows past them', () => {
  expect(formatCardId(1)).toBe('MB-001')
  expect(formatCardId(42)).toBe('MB-042')
  expect(formatCardId(1234)).toBe('MB-1234')
})

test('claimNextCardFolder increments sequentially', () => {
  const root = tempRoot()
  expect(claimNextCardFolder(root).name).toBe('MB-001')
  expect(claimNextCardFolder(root).name).toBe('MB-002')
})

test('claimNextCardFolder never reuses the id of a deleted card', () => {
  const root = tempRoot()
  claimNextCardFolder(root)
  const { path } = claimNextCardFolder(root)
  rmSync(path, { recursive: true })
  expect(claimNextCardFolder(root).name).toBe('MB-003')
})

test('claimNextCardFolder continues after folders created outside the sequence', () => {
  const root = tempRoot()
  mkdirSync(join(root, 'MB-007'))
  mkdirSync(join(root, 'TAT1C0-154'))
  expect(claimNextCardFolder(root).name).toBe('MB-008')
})

test('createCard keeps the requested Jira key and numbers manual cards', () => {
  const root = tempRoot()
  expect(createCard(root, { name: 'TAT1C0-154', title: 'Jira' }).folder).toBe('TAT1C0-154')
  expect(createCard(root, { title: 'Manual' }).folder).toBe('MB-001')
})

test('MB ids are not treated as Jira keys', () => {
  expect(JIRA_KEY_PATTERN.test('MB-001')).toBe(false)
  expect(JIRA_KEY_PATTERN.test('mb-001')).toBe(false)
  expect(JIRA_KEY_PATTERN.test('TAT1C0-154')).toBe(true)
})
