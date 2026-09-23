import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { GeneralSettingsForm } from './GeneralSettingsForm'
import { refresh } from './features/cards/model/card-commands'
import { saveMegaBrainSettings } from './features/cards/api/card-detail-api'
import type { BoardSettings, EditorDiscovery, GeneralSettings, MegaBrainSettings } from '../shared/domain/settings'

function stagesForProvider(stages: BoardSettings, provider: GeneralSettings['llmProvider']): BoardSettings {
  return Object.fromEntries(
    Object.entries(stages).map(([key, stage]) => [
      key,
      {
        ...stage,
        model: provider === 'chatgpt' ? 'default' : key === 'run-test-checklist' ? 'sonnet' : 'fable',
      },
    ]),
  ) as BoardSettings
}

export function OnboardingDialog({
  initial,
  editors,
  onComplete,
}: {
  initial: MegaBrainSettings
  editors: EditorDiscovery
  onComplete: (settings: MegaBrainSettings) => void
}) {
  const [step, setStep] = useState(0)
  const [general, setGeneral] = useState(() => {
    if (editors.editors.some((editor) => editor.id === initial.general.editor)) return initial.general
    const detected = editors.editors[0]
    return detected ? { ...initial.general, editor: detected.id } : { ...initial.general, editor: 'custom' as const }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = async () => {
    setSaving(true)
    setError(null)
    try {
      const providerChanged = initial.general.llmProvider !== general.llmProvider
      const saved = await saveMegaBrainSettings({
        general: { ...general, onboardingCompleted: true },
        stages: providerChanged ? stagesForProvider(initial.stages, general.llmProvider) : initial.stages,
      })
      await refresh()
      window.localStorage.setItem('mega-brain-onboarding-tour-v1', 'done')
      onComplete(saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" showCloseButton={false}>
        <div className="flex gap-1" aria-label={`Etapa ${step + 1} de 3`}>
          {[0, 1, 2].map((item) => (
            <span key={item} className={`h-1 flex-1 rounded-full ${item <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>
        {step === 0 ? (
          <>
            <DialogHeader className="items-center text-center">
              <img src="/brain.svg" alt="" className="size-14" />
              <DialogTitle>Bem-vindo ao Mega Brain</DialogTitle>
              <DialogDescription className="max-w-md">
                Conheça as principais áreas do app e configure seu ambiente. Você poderá alterar as preferências depois.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <strong className="block">Editor</strong>
                <span className="text-xs text-muted-foreground">Abra cada card na ferramenta certa.</span>
              </div>
              <div className="rounded-lg border p-3">
                <strong className="block">Diretórios</strong>
                <span className="text-xs text-muted-foreground">Escolha workspace e worktrees.</span>
              </div>
              <div className="rounded-lg border p-3">
                <strong className="block">IA</strong>
                <span className="text-xs text-muted-foreground">Use Claude ou ChatGPT.</span>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setStep(1)}>Conhecer o app</Button>
            </DialogFooter>
          </>
        ) : step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>O que você pode fazer no Mega Brain</DialogTitle>
              <DialogDescription>Seu trabalho fica organizado em cards, repositórios e sessões de agentes.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['Kanban', 'Organize cards por etapa, mova-os entre colunas e acompanhe o fluxo de trabalho.'],
                ['Cards e Jira', 'Crie tarefas, veja detalhes e diff, acompanhe agentes e sincronize cards com Jira.'],
                ['Agentes', 'Acompanhe sessões de agentes, veja o estado de execução e abra o card relacionado.'],
                ['Repositórios', 'Consulte repositórios e seus diretórios de trabalho para navegar pelo código.'],
                ['Deploy e progresso', 'Prepare PRs para deploy, acompanhe o consumo de IA e use o minimapa para navegar pelo quadro.'],
                ['Comandos rápidos', 'Use Ctrl+K para buscar cards, criar um card ou abrir configurações e repositórios.'],
                ['Configurações e integrações', 'Ajuste etapas e modelos de IA, editor, diretórios e integrações como Jira. O botão Café também fica no topo.'],
              ].map(([title, description]) => (
                <div key={title} className="rounded-lg border p-3">
                  <strong className="block text-sm">{title}</strong>
                  <span className="text-xs text-muted-foreground">{description}</span>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(0)}>
                Voltar
              </Button>
              <Button onClick={() => setStep(2)}>Configurar ambiente</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Configure seu ambiente</DialogTitle>
              <DialogDescription>Os diretórios serão criados caso ainda não existam.</DialogDescription>
            </DialogHeader>
            <GeneralSettingsForm value={general} onChange={setGeneral} disabled={saving} initialEditors={editors} />
            {error && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button
                disabled={
                  saving ||
                  (general.editor === 'custom' && !general.editorCommand.trim()) ||
                  !general.workspaceDir.trim() ||
                  !general.worktreesDir.trim()
                }
                onClick={() => void finish()}
              >
                {saving ? 'Salvando…' : 'Concluir configuração'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
