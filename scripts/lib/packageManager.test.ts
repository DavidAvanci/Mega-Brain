import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { detectPackageManager, installCommand, lockfilesMatch, runScriptCommand } from './packageManager'

const repo = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

test('repo sem pista nenhuma é npm', () => {
  expect(detectPackageManager(repo({ 'package.json': '{}' }))).toBe('npm')
})

test('packageManager do package.json manda em cima dos lockfiles', () => {
  const dir = repo({ 'package.json': '{"packageManager":"yarn@4.9.4"}', 'package-lock.json': '{}' })
  expect(detectPackageManager(dir)).toBe('yarn')
})

test('.yarnrc.yml marca yarn', () => {
  expect(detectPackageManager(repo({ 'package.json': '{}', '.yarnrc.yml': '' }))).toBe('yarn')
})

test('package-lock ganha de um yarn.lock gerado por engano', () => {
  const dir = repo({ 'package.json': '{}', 'package-lock.json': '{}', 'yarn.lock': '' })
  expect(detectPackageManager(dir)).toBe('npm')
})

test('yarn.lock sozinho marca yarn', () => {
  expect(detectPackageManager(repo({ 'package.json': '{}', 'yarn.lock': '' }))).toBe('yarn')
})

test('npm precisa de -- para repassar flags ao script', () => {
  const dir = repo({ 'package.json': '{}' })
  expect(runScriptCommand(dir, 'dev', ['--port', '3000'])).toEqual({ cmd: 'npm', args: ['run', 'dev', '--', '--port', '3000'] })
  expect(runScriptCommand(dir, 'build')).toEqual({ cmd: 'npm', args: ['run', 'build'] })
  expect(installCommand(dir)).toEqual({ cmd: 'npm', args: ['install'] })
})

test('yarn recebe as flags direto', () => {
  const dir = repo({ 'package.json': '{"packageManager":"yarn@4.9.4"}' })
  expect(runScriptCommand(dir, 'dev', ['--port', '3000'])).toEqual({ cmd: 'yarn', args: ['dev', '--port', '3000'] })
  expect(installCommand(dir)).toEqual({ cmd: 'yarn', args: ['install'] })
})

test('lockfilesMatch compara o lockfile do gerenciador detectado', () => {
  const left = repo({ 'package.json': '{}', 'package-lock.json': '{"lockfileVersion":3}' })
  const right = repo({ 'package.json': '{}', 'package-lock.json': '{"lockfileVersion":3}' })

  expect(lockfilesMatch(left, right)).toBe(true)
  writeFileSync(join(right, 'package-lock.json'), '{"lockfileVersion":2}')
  expect(lockfilesMatch(left, right)).toBe(false)
})

test('lockfilesMatch exige lockfiles existentes e o mesmo gerenciador', () => {
  const npm = repo({ 'package.json': '{}', 'package-lock.json': '{}' })
  const yarn = repo({ 'package.json': '{}', 'yarn.lock': '' })
  const withoutLock = repo({ 'package.json': '{}' })

  expect(lockfilesMatch(npm, yarn)).toBe(false)
  expect(lockfilesMatch(npm, withoutLock)).toBe(false)
})
