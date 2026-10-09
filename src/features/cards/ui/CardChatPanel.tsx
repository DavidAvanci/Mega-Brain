import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { DevEnvAgentTerminal, type DevEnvTerminalHandle } from '@/features/dev-environments/DevEnvAgentTerminal'
import type { DevEnvStartOptions } from '../../../../shared/domain/dev-environments'

const ChatTab = lazy(() => import('@/features/chat/ChatTab').then((module) => ({ default: module.ChatTab })))

export type EnvironmentChatRequest = { id: number; cardId: string; text?: string; configuration?: DevEnvStartOptions }

export function CardChatPanel({
  cardId,
  environmentRequest,
  onEnvironmentRunningChange,
}: {
  cardId: string
  environmentRequest?: EnvironmentChatRequest
  onEnvironmentRunningChange: (running: boolean) => void
}) {
  const [tab, setTab] = useState('executions')
  const [running, setRunning] = useState(false)
  const terminal = useRef<DevEnvTerminalHandle>(null)
  const handled = useRef<number | null>(null)
  const request = environmentRequest?.cardId === cardId ? environmentRequest : undefined
  useEffect(() => {
    if (request) setTab('environment')
  }, [request])
  useEffect(() => {
    if (!request || tab !== 'environment' || handled.current === request.id) return
    handled.current = request.id
    if (request.text) void terminal.current?.send(request.text, request.configuration)
    else terminal.current?.focus()
  }, [request, tab])
  useEffect(() => {
    onEnvironmentRunningChange(running)
  }, [running, onEnvironmentRunningChange])

  return (
    <Tabs value={tab} onValueChange={setTab} className="h-full min-h-0 gap-0">
      <TabsList
        variant="line"
        aria-label="Conversas do card"
        className="w-full shrink-0 justify-start border-b px-3 group-data-horizontal/tabs:h-12"
      >
        <TabsTrigger value="executions" className="min-h-10 flex-none px-3">
          Execuções
        </TabsTrigger>
        <TabsTrigger value="environment" className="min-h-10 flex-none px-3">
          Ambiente{running && <Spinner aria-label="Agente de ambiente em execução" className="size-3" />}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="executions" keepMounted className="min-h-0 overflow-hidden">
        <Suspense fallback={<p className="p-4 text-xs text-muted-foreground">Carregando execuções…</p>}>
          <ChatTab cardId={cardId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="environment" keepMounted className="min-h-0 overflow-hidden">
        <DevEnvAgentTerminal ref={terminal} cardId={cardId} onRunningChange={setRunning} />
      </TabsContent>
    </Tabs>
  )
}
