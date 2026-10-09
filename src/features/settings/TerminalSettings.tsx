import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/ui/select'
import type { SettingsSectionProps } from './settings-form'

const TERMINALS = [
  { value: '', label: 'Automático', description: 'Usa o terminal padrão do sistema do backend.' },
  { value: 'Terminal', label: 'Terminal do macOS' },
  { value: 'iTerm2', label: 'iTerm2 · macOS' },
  { value: 'wt.exe', label: 'Windows Terminal · Windows / WSL' },
  { value: 'x-terminal-emulator', label: 'Terminal do Linux' },
  { value: 'custom', label: 'Personalizado' },
]
const SHELLS = [
  { value: '', label: 'Automático', description: 'Executa o agente diretamente no terminal selecionado.' },
  { value: 'zsh', label: 'Zsh' },
  { value: 'bash', label: 'Bash' },
  { value: 'custom', label: 'Personalizado' },
]

export function TerminalSettings({ value, onChange, disabled }: SettingsSectionProps) {
  const terminalCommand = value.terminalCommand ?? ''
  const shellCommand = value.shellCommand ?? ''
  const [customTerminal, setCustomTerminal] = useState(false)
  const [customShell, setCustomShell] = useState(false)
  const terminal =
    !customTerminal && TERMINALS.some((option) => option.value === terminalCommand) ? terminalCommand : 'custom'
  const shell = !customShell && SHELLS.some((option) => option.value === shellCommand) ? shellCommand : 'custom'
  const update = (patch: Partial<typeof value>) => onChange({ ...value, ...patch })

  return (
    <section className="grid gap-6" aria-label="Shell e terminal">
      <div>
        <h3 className="text-sm font-medium">Shell e terminal</h3>
        <p className="text-xs text-muted-foreground">
          Configure onde abrir os agentes e qual shell usar para carregar seu ambiente.
        </p>
      </div>
      <div className="grid gap-3" data-settings-section="terminal">
        <label htmlFor="settings-terminal" className="text-xs font-medium">
          Terminal
        </label>
        <AppSelect
          id="settings-terminal"
          ariaLabel="Terminal"
          describedBy="terminal-command-help"
          value={terminal}
          options={TERMINALS}
          disabled={disabled}
          onValueChange={(next) => {
            setCustomTerminal(next === 'custom')
            update({ terminalCommand: next === 'custom' ? '' : next })
          }}
        />
        {terminal === 'custom' && (
          <label className="grid gap-1 text-xs font-medium">
            Aplicativo ou executável do terminal
            <Input
              value={terminalCommand}
              disabled={disabled}
              spellCheck={false}
              placeholder="/Applications/iTerm.app ou comando"
              onChange={(event) => update({ terminalCommand: event.target.value })}
            />
          </label>
        )}
        <p id="terminal-command-help" className="text-xs text-muted-foreground">
          Automático usa o Terminal no macOS, Windows Terminal no WSL ou o terminal do Linux. Essa escolha vale para os
          ambientes de testes e a retomada de agentes.
        </p>
      </div>
      <div className="grid gap-3" data-settings-section="shell">
        <label htmlFor="settings-shell" className="text-xs font-medium">
          Shell
        </label>
        <AppSelect
          id="settings-shell"
          ariaLabel="Shell"
          describedBy="shell-command-help"
          value={shell}
          options={SHELLS}
          disabled={disabled}
          onValueChange={(next) => {
            setCustomShell(next === 'custom')
            update({ shellCommand: next === 'custom' ? '' : next })
          }}
        />
        {shell === 'custom' && (
          <label className="grid gap-1 text-xs font-medium">
            Executável do shell
            <Input
              value={shellCommand}
              disabled={disabled}
              spellCheck={false}
              placeholder="/bin/zsh ou /bin/bash"
              onChange={(event) => update({ shellCommand: event.target.value })}
            />
          </label>
        )}
        <p id="shell-command-help" className="text-xs text-muted-foreground">
          Zsh, Bash ou um shell compatível com POSIX carregam o ambiente de login antes de executar o agente. Informe
          apenas o executável, sem argumentos.
        </p>
      </div>
    </section>
  )
}
