import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FlowLevel } from '../../shared/domain/cards'
import { readFlow } from './card-folder'

export interface WorktreeOrigin {
  ref: string
  hash: string
  repository?: string
  createdAt?: string
}

export interface CardData {
  title: string
  description: string
  status: string
  flow?: FlowLevel
  prs?: { staging?: Record<string, string>; master?: Record<string, string> }
  worktrees?: Record<string, WorktreeOrigin>
}

function readPrEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function readPrs(value: unknown): CardData['prs'] {
  if (!value || typeof value !== 'object') return undefined
  const { staging, master } = value as Record<string, unknown>
  const prs = { staging: readPrEnv(staging), master: readPrEnv(master) }
  return prs.staging || prs.master ? prs : undefined
}

function readWorktrees(value: unknown): CardData['worktrees'] {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value).flatMap(([repo, raw]) => {
    if (!raw || typeof raw !== 'object') return []
    const { ref, hash, repository, createdAt } = raw as Record<string, unknown>
    if (typeof ref !== 'string' || !ref || typeof hash !== 'string' || !hash) return []
    return [
      [
        repo,
        {
          ref,
          hash,
          repository: typeof repository === 'string' ? repository : undefined,
          createdAt: typeof createdAt === 'string' ? createdAt : undefined,
        },
      ] as const,
    ]
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function readCard(folderPath: string, name: string): CardData {
  let data: Partial<CardData> = {}
  const file = join(folderPath, 'card.json')
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {}
  }
  return {
    title: typeof data.title === 'string' && data.title ? data.title : name,
    description: typeof data.description === 'string' ? data.description : '',
    status: typeof data.status === 'string' && data.status ? data.status : 'a-fazer',
    flow: readFlow(data.flow),
    prs: readPrs(data.prs),
    worktrees: readWorktrees(data.worktrees),
  }
}

export function writeCard(folderPath: string, card: CardData): void {
  writeFileSync(join(folderPath, 'card.json'), `${JSON.stringify(card, null, 2)}\n`)
}
