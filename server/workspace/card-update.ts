import { readFlow } from './card-folder'
import { readCard, type CardData, writeCard } from './card-record'
import { stageFor, type Stage } from './stage-catalog'

export type CardStageStarter = (path: string, stage: Stage, card: CardData) => void

export function updateCard(
  cardPath: string,
  cardName: string,
  data: Record<string, unknown>,
  startStage: CardStageStarter,
): void {
  const previous = readCard(cardPath, cardName)
  const next = {
    ...previous,
    title: data.title === undefined ? previous.title : String(data.title),
    description: data.description === undefined ? previous.description : String(data.description),
    status: data.status === undefined ? previous.status : String(data.status),
    flow: readFlow(data.flow === undefined ? previous.flow : data.flow),
  }
  writeCard(cardPath, next)
  const stage = stageFor(next.status)
  if (stage && next.status !== previous.status) startStage(cardPath, stage, next)
}
