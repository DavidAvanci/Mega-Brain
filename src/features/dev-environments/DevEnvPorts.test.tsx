// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { DevEnvPorts } from './DevEnvPorts'

test('distingue porta prevista da porta em execução e mantém processos fora da seleção visíveis', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const open = vi.fn()
  try {
    await act(async () =>
      root.render(
        <DevEnvPorts
          projects={[
            { repo: 'api', port: 4100, selected: true },
            { repo: 'frontend', port: 5173, selected: true },
            { repo: 'ignored', port: 5200, selected: false },
          ]}
          apps={[
            {
              repo: 'api',
              kind: 'backend',
              source: 'worktree',
              port: 3333,
              status: 'rodando',
              url: 'http://localhost:3333',
            },
            {
              repo: 'old-worker',
              kind: 'backend',
              source: 'worktree',
              port: 4200,
              status: 'rodando',
              url: 'http://localhost:4200',
            },
          ]}
          onOpen={open}
        />,
      ),
    )
    const rows = [...host.querySelectorAll('tbody tr')]
    expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual(['api', 'frontend', 'old-worker'])
    expect([...rows[0].querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['4100', '3333', 'Rodando', ''])
    expect([...rows[1].querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['5173', '—', 'Previsto', ''])
    expect([...rows[2].querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['—', '4200', 'Rodando', ''])
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Abrir api na porta 3333"]')!.click(),
    )
    expect(open).toHaveBeenCalledWith('api')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
