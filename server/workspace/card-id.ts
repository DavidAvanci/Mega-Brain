import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD_ID = /^MB-(\d+)$/i
const SEQUENCE_FILE = '.mega-brain-sequence'

export function formatCardId(sequence: number): string {
  return `MB-${String(sequence).padStart(3, '0')}`
}

function readSequence(root: string): number {
  try {
    return Number.parseInt(readFileSync(join(root, SEQUENCE_FILE), 'utf8'), 10) || 0
  } catch {
    return 0
  }
}

function highestFolderSequence(root: string): number {
  return readdirSync(root).reduce((highest, name) => {
    const match = CARD_ID.exec(name)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
}

// Sequência persistida para que IDs de cards excluídos nunca sejam reutilizados
export function claimNextCardFolder(root: string): { name: string; path: string } {
  for (let sequence = Math.max(readSequence(root), highestFolderSequence(root)) + 1; ; sequence++) {
    const name = formatCardId(sequence)
    const path = join(root, name)
    try {
      mkdirSync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    writeFileSync(join(root, SEQUENCE_FILE), `${sequence}\n`)
    return { name, path }
  }
}
