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

test('pnpm declarado ou detectado pelo lockfile instala e executa scripts com pnpm', () => {
  const fixtures: Record<string, string>[] = [{ 'package.json': '{"packageManager":"pnpm@10.33.0"}', 'pnpm-lock.yaml': 'lockfileVersion: 9' }, { 'pnpm-lock.yaml': 'lockfileVersion: 9' }]
  for (const files of fixtures) {
    const dir = repo(files)
    expect(detectPackageManager(dir)).toBe('pnpm')
    expect(installCommand(dir)).toEqual({ cmd: 'pnpm', args: ['install'] })
    expect(runScriptCommand(dir, 'test', ['--run'])).toEqual({ cmd: 'pnpm', args: ['run', 'test', '--run'] })
    const other = repo(files)
    expect(lockfilesMatch(dir, other)).toBe(true)
    writeFileSync(join(other, 'pnpm-lock.yaml'), 'changed')
    expect(lockfilesMatch(dir, other)).toBe(false)
  }
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
  expect(runScriptCommand(dir, 'dev', ['--port', '3000'])).toEqual({
    cmd: 'npm',
    args: ['run', 'dev', '--', '--port', '3000'],
  })
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

test('pnpm declarado no package.json instala e roda scripts com pnpm', () => {
  const dir = repo({ 'package.json': '{"packageManager":"pnpm@10.33.0"}' })
  expect(detectPackageManager(dir)).toBe('pnpm')
  expect(installCommand(dir)).toEqual({ cmd: 'pnpm', args: ['install'] })
  expect(runScriptCommand(dir, 'dev', ['--port', '3000'])).toEqual({ cmd: 'pnpm', args: ['run', 'dev', '--port', '3000'] })
})

test('pnpm-lock.yaml sozinho marca pnpm e é o lockfile comparado', () => {
  const left = repo({ 'package.json': '{}', 'pnpm-lock.yaml': 'lockfileVersion: 9.0' })
  const right = repo({ 'package.json': '{}', 'pnpm-lock.yaml': 'lockfileVersion: 9.0' })

  expect(detectPackageManager(left)).toBe('pnpm')
  expect(lockfilesMatch(left, right)).toBe(true)
  writeFileSync(join(right, 'pnpm-lock.yaml'), 'lockfileVersion: 6.0')
  expect(lockfilesMatch(left, right)).toBe(false)
})
