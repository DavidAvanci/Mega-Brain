import { useEffect, useRef, useState } from 'react'
import type { CardTriageResult } from '../../../../shared/domain/card-triage'
import { requestCardTriage } from '../api/card-triage-api'

type TriageState = { status: 'idle' | 'loading' } | { status: 'error'; message: string } | CardTriageResult
export function useCardTriage() {
  const [state, setState] = useState<TriageState>({ status: 'idle' })
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const invalidate = () => {
    generation.current++
    controller.current?.abort()
    controller.current = null
    setState({ status: 'idle' })
  }
  useEffect(
    () => () => {
      generation.current++
      controller.current?.abort()
    },
    [],
  )
  const suggest = async (title: string, description: string) => {
    invalidate()
    const current = generation.current
    const abort = new AbortController()
    controller.current = abort
    setState({ status: 'loading' })
    try {
      const result = await requestCardTriage({ title, description }, abort.signal)
      if (generation.current === current) setState(result)
    } catch (error) {
      if (generation.current === current && !abort.signal.aborted)
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Não foi possível consultar a Laya.',
        })
    } finally {
      if (controller.current === abort) controller.current = null
    }
  }
  return { state, suggest, invalidate }
}
