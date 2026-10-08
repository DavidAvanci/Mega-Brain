import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export function claudeKeychainService(credentialsFile: string): string {
  const directory = resolve(dirname(credentialsFile))
  return directory === join(homedir(), '.claude')
    ? 'Claude Code-credentials'
    : `Claude Code-credentials-${createHash('sha256').update(directory).digest('hex').slice(0, 8)}`
}
export async function readClaudeCredentials(credentialsFile: string): Promise<string> {
  try {
    return await readFile(credentialsFile, 'utf8')
  } catch {
    /* macOS commonly stores the credentials only in Keychain. */
  }
  if (process.platform !== 'darwin') throw new Error('credentials_unreadable')
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/security',
      ['find-generic-password', '-s', claudeKeychainService(credentialsFile), '-w'],
      { timeout: 4_000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error('credentials_unreadable'))
        resolve(stdout.trim())
      },
    )
  })
}
