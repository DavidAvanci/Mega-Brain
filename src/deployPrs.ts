import type { Card } from './types'

export interface OpenMasterPr {
  cardId: string
  cardTitle: string
  url: string
}

export interface OpenMasterPrGroup {
  project: string
  prs: OpenMasterPr[]
}

export function groupOpenMasterPrs(cards: Card[]): OpenMasterPrGroup[] {
  const projects = new Map<string, OpenMasterPr[]>()

  for (const card of cards) {
    if (card.status !== 'aguardando-deploy') continue

    for (const [project, url] of Object.entries(card.prs?.master ?? {})) {
      if (card.prStates?.[url] !== 'open') continue
      const prs = projects.get(project)
      const pr = { cardId: card.id, cardTitle: card.title, url }
      if (prs) prs.push(pr)
      else projects.set(project, [pr])
    }
  }

  return [...projects.entries()]
    .map(([project, prs]) => ({
      project,
      prs: [...prs].sort((a, b) => a.cardTitle.localeCompare(b.cardTitle, 'pt-BR')),
    }))
    .sort((a, b) => a.project.localeCompare(b.project, 'pt-BR'))
}
