import { requestJson } from '@/shared/api/request-json'
import { validateCardTriageResponse, type CardTriageInput } from '../../../../shared/domain/card-triage'

export async function requestCardTriage(input: CardTriageInput, signal?: AbortSignal) {
  const response = await requestJson<unknown>('/api/card-triage', 'Não foi possível sugerir agora', {
    method: 'POST',
    body: input,
    signal,
  })
  return validateCardTriageResponse(response)
}
