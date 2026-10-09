import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { readTail } from '../../agent-log'
import type { DevEnvLogs } from '../../../shared/domain/dev-environments'

const LOG_BYTES = 64 * 1024

export function redactDevEnvOutput(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [oculto]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[oculto]@')
    .replace(
      /((?:\b[\w-]*(?:password|passwd|token|secret|api[_-]?key|authorization|credential|capability)[\w-]*)[\\"']*\s*[:=]\s*)(?:\\*"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,
      '$1[oculto]',
    )
}

export function readDevEnvLogs(cardPath: string, file?: unknown): DevEnvLogs {
  const root = join(realpathSync(cardPath), '.dev-env')
  if (!existsSync(root)) return { files: [], file: null, content: '', truncated: false }
  if (lstatSync(root).isSymbolicLink()) throw new Error('Diretório de logs inválido')
  const files = readdirSync(root)
    .filter((name) => /^[\w.-]+\.log$/.test(name) && lstatSync(join(root, name)).isFile())
    .sort()
  const selected = typeof file === 'string' && file ? file : files[0]
  if (!selected) return { files, file: null, content: '', truncated: false }
  if (!files.includes(selected)) throw new Error('Log indisponível para este ambiente')
  const path = join(root, selected)
  return {
    files,
    file: selected,
    content: redactDevEnvOutput(readTail(path, LOG_BYTES)),
    truncated: statSync(path).size > LOG_BYTES,
  }
}
