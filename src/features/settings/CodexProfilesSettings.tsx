import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon, FloppyDiskIcon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/Tip'
import { requestJson } from '@/shared/api/request-json'
import type { CodexProfile, CodexProfiles, CodexProfilesResponse } from '../../../shared/domain/codex-profiles'

const PROFILE_PATH = '/api/codex/profiles'
const NEW_PROFILE_COLORS = ['#64B8FF', '#B69CFF', '#73D99A', '#FFB454', '#FF7373']

type IslandProfiles = {
  hiddenIds: string[]
  showBadge: boolean
  onHiddenChange: (ids: string[]) => void
  onBadgeChange: (show: boolean) => void
}

export function CodexProfilesSettings({ compact = false, island }: { compact?: boolean; island?: IslandProfiles }) {
  const [value, setValue] = useState<CodexProfiles>({ profiles: [], activeId: '' })
  const [discovered, setDiscovered] = useState<CodexProfilesResponse['discovered']>([])
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(value)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const mounted = useRef(false)
  const generation = useRef(0)

  const load = useCallback(async (silent = false) => {
    const started = generation.current
    try {
      const response = await requestJson<CodexProfilesResponse>(PROFILE_PATH, 'Falha ao carregar os perfis do Codex')
      if (!mounted.current || started !== generation.current || dirtyRef.current || savingRef.current) return
      current.current = { profiles: response.profiles, activeId: response.activeId }
      setValue(current.current)
      setDiscovered(response.discovered)
      setLoaded(true)
      setError('')
    } catch (cause: unknown) {
      if (mounted.current && !silent) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    let polling = false
    void load()
    const timer = setInterval(() => {
      if (dirtyRef.current || savingRef.current || polling) return
      polling = true
      void load(true).finally(() => {
        polling = false
      })
    }, 5000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [load])

  const update = (next: CodexProfiles) => {
    current.current = next
    dirtyRef.current = true
    generation.current += 1
    setValue(next)
    setDirty(true)
    setSaved(false)
    setError('')
  }
  const updateProfile = (id: string, patch: Partial<CodexProfile>) => {
    update({
      ...current.current,
      profiles: current.current.profiles.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile)),
    })
  }
  const add = (found?: CodexProfilesResponse['discovered'][number]) => {
    const profile: CodexProfile = {
      id: crypto.randomUUID(),
      name: found?.name ?? 'Novo perfil',
      home: found?.home ?? '',
      color: NEW_PROFILE_COLORS[current.current.profiles.length % NEW_PROFILE_COLORS.length],
    }
    update({ profiles: [...current.current.profiles, profile], activeId: current.current.activeId || profile.id })
  }
  const remove = (id: string) => {
    const profiles = current.current.profiles.filter((profile) => profile.id !== id)
    update({ profiles, activeId: current.current.activeId === id ? profiles[0].id : current.current.activeId })
  }
  const save = async () => {
    if (savingRef.current) return
    const snapshot = current.current
    if (snapshot.profiles.some((profile) => !profile.name.trim() || !profile.home.trim())) {
      setError('Preencha o nome e a pasta de cada perfil.')
      return
    }
    savingRef.current = true
    generation.current += 1
    setSaving(true)
    setError('')
    try {
      const response = await requestJson<CodexProfilesResponse>(PROFILE_PATH, 'Falha ao salvar os perfis do Codex', {
        method: 'PUT',
        body: snapshot,
      })
      current.current = { profiles: response.profiles, activeId: response.activeId }
      dirtyRef.current = false
      generation.current += 1
      window.dispatchEvent(new Event('megabrain:codex-profiles-changed'))
      if (mounted.current) {
        setValue(current.current)
        setDiscovered(response.discovered)
        setDirty(false)
        setSaved(true)
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }

  const editor = (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        Cada perfil usa sua própria pasta CODEX_HOME. O padrão vale para novas execuções do Mega Brain.
      </p>
      <fieldset className="grid gap-2" disabled={!loaded || saving}>
        {value.profiles.map((profile) => (
          <div
            key={profile.id}
            className="grid min-w-0 gap-2 rounded-lg border p-3"
            aria-label={`Perfil ${profile.name}`}
          >
            <div className="flex items-center gap-2">
              <label className="shrink-0">
                <span className="sr-only">Cor do perfil {profile.name}</span>
                <input
                  type="color"
                  aria-label={`Cor do perfil ${profile.name}`}
                  className="size-7 cursor-pointer rounded-md border bg-background p-0.5"
                  value={profile.color}
                  onChange={(event) => updateProfile(profile.id, { color: event.target.value })}
                />
              </label>
              <input
                aria-label={`Nome do perfil ${profile.name}`}
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs"
                value={profile.name}
                onChange={(event) => updateProfile(profile.id, { name: event.target.value })}
              />
              <Tip label="Remover perfil">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remover perfil ${profile.name}`}
                  disabled={value.profiles.length <= 1}
                  onClick={() => remove(profile.id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </Tip>
            </div>
            <label className="grid gap-1 text-[10px] text-muted-foreground">
              Pasta do Codex (CODEX_HOME)
              <input
                aria-label={`Pasta do perfil ${profile.name}`}
                className="min-w-0 rounded-md border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
                placeholder="/Users/seu-usuário/.codex"
                value={profile.home}
                onChange={(event) => updateProfile(profile.id, { home: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name={`codex-default-${compact ? 'island' : 'tools'}`}
                aria-label={`Usar ${profile.name} em novas execuções`}
                checked={value.activeId === profile.id}
                onChange={() => update({ ...current.current, activeId: profile.id })}
              />
              Padrão para novas execuções
            </label>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Tip label="Adicionar perfil">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Adicionar perfil do Codex"
              disabled={value.profiles.length >= 20}
              onClick={() => add()}
            >
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            </Button>
          </Tip>
          {discovered.some((found) => !value.profiles.some((profile) => profile.home === found.home)) && (
            <select
              aria-label="Adicionar perfil encontrado"
              className="min-w-0 flex-1 rounded-md border bg-background p-2 text-xs"
              value=""
              disabled={value.profiles.length >= 20}
              onChange={(event) => {
                const found = discovered.find((entry) => entry.home === event.target.value)
                if (found) add(found)
              }}
            >
              <option value="">Adicionar pasta encontrada…</option>
              {discovered
                .filter((found) => !value.profiles.some((profile) => profile.home === found.home))
                .map((found) => (
                  <option key={found.home} value={found.home}>
                    {found.name} · {found.home}
                  </option>
                ))}
            </select>
          )}
          <Tip label="Salvar perfis">
            <Button
              type="button"
              variant="default"
              size="icon-sm"
              aria-label="Salvar perfis do Codex"
              disabled={!dirty}
              onClick={() => void save()}
            >
              <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={2} />
            </Button>
          </Tip>
        </div>
      </fieldset>
    </div>
  )

  return (
    <section className="grid gap-3" aria-label="Perfis do Codex" data-settings-section="codex-profiles">
      <div>
        <h3 className="text-sm font-medium">Perfis do Codex</h3>
        <p className="text-xs text-muted-foreground">Identifique suas contas e acompanhe as sessões de cada perfil.</p>
        <p className="mt-1 text-[10px] text-muted-foreground" role="status" aria-live="polite">
          {saving
            ? 'Salvando perfis…'
            : !loaded
              ? 'Carregando perfis…'
              : dirty
                ? 'Alterações pendentes · salve os perfis'
                : saved
                  ? 'Perfis salvos'
                  : 'Perfis sincronizados'}
        </p>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2">
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
          <Tip label="Tentar novamente">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Tentar salvar perfis novamente"
              disabled={saving}
              onClick={() => void (loaded ? save() : load())}
            >
              <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
            </Button>
          </Tip>
        </div>
      )}
      {island && (
        <fieldset className="grid gap-2" disabled={!loaded || saving}>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={island.showBadge}
              onChange={(event) => island.onBadgeChange(event.target.checked)}
            />
            Mostrar identificação do perfil na ilha
          </label>
          {value.profiles.map((profile) => (
            <label key={profile.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                aria-label={`Mostrar ${profile.name} na ilha`}
                checked={!island.hiddenIds.includes(profile.id)}
                onChange={(event) =>
                  island.onHiddenChange(
                    event.target.checked
                      ? island.hiddenIds.filter((id) => id !== profile.id)
                      : [...island.hiddenIds, profile.id],
                  )
                }
              />
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: profile.color }} />
              {profile.name}
            </label>
          ))}
        </fieldset>
      )}
      {compact ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium">Editar perfis e padrão de execução</summary>
          <div className="mt-3">{editor}</div>
        </details>
      ) : (
        editor
      )}
    </section>
  )
}
