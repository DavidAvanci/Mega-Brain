import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FLOW_LEVELS, type FlowLevel } from '../../src/types.ts'

const CARD_ID = /^MB-(\d+)$/i
const SEQUENCE_FILE = '.mega-brain-sequence'

export const DEFAULT_FLOW: FlowLevel = 'dificil'

export function readFlow(value: unknown): FlowLevel {
  return typeof value === 'string' && FLOW_LEVELS.includes(value as FlowLevel)
    ? value as FlowLevel
    : DEFAULT_FLOW
}

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

function claimNamedFolder(root: string, requested: string): { name: string; path: string } {
  let name = requested
  for (let n = 2; existsSync(join(root, name)); n++) name = `${requested}-${n}`
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return { name, path }
}

export function createCard(root: string, data: Record<string, unknown>): { folder: string; path: string } {
  const requested = String(data.name ?? '')
  const { name, path } = /^[\w-]+$/.test(requested) ? claimNamedFolder(root, requested) : claimNextCardFolder(root)
  const card = {
    title: String(data.title ?? '').trim() || name,
    description: String(data.description ?? '').trim(),
    status: 'a-fazer',
    flow: readFlow(data.flow),
  }
  writeFileSync(join(path, 'card.json'), `${JSON.stringify(card, null, 2)}\n`)
  return { folder: name, path }
}
