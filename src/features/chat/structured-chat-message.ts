const RESULT_STATUSES: Record<string, string> = {
  done: 'Concluído',
  failed: 'Falhou',
  blocked: 'Bloqueado',
}

const PARAGRAPH_OPENERS =
  '(?:Além disso|Ainda assim|A resposta|Com isso|Em seguida|Na verdade|No entanto|Por outro lado|Portanto|Sim|Não|Mas|Agora|Pronto)'

export function separateChatParagraphs(text: string): string {
  return text.replace(new RegExp(`([.!?])(?:[ \\t]+|\\r?\\n)?(?=${PARAGRAPH_OPENERS}\\b)`, 'giu'), '$1\n\n')
}

export function structuredChatMessage(text: string): { status: string; note: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    if (!value || typeof value !== 'object') return null
    const result = value as { status?: unknown; note?: unknown }
    if (
      typeof result.status !== 'string' ||
      !Object.hasOwn(RESULT_STATUSES, result.status) ||
      typeof result.note !== 'string' ||
      !result.note.trim()
    )
      return null
    return { status: RESULT_STATUSES[result.status], note: result.note.trim() }
  } catch {
    return null
  }
}
