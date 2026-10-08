import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/shared/api/api-client'
import type { KnowledgePage } from '../../../shared/domain/knowledge'
import { knowledgeApi } from './api'
export type KnowledgeDraft = { title: string; markdown: string; baseRevision: number }
export function draftKey(id: string): string {
  return `mega-brain-knowledge-draft:${id}`
}
export function readDraft(id: string): KnowledgeDraft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(id)) ?? 'null')
    return draft &&
      typeof draft.title === 'string' &&
      typeof draft.markdown === 'string' &&
      Number.isSafeInteger(draft.baseRevision)
      ? draft
      : null
  } catch {
    return null
  }
}
export function persistDraft(id: string, draft: KnowledgeDraft): void {
  localStorage.setItem(draftKey(id), JSON.stringify(draft))
}
export function conflictPage(error: unknown): KnowledgePage | null {
  if (
    !(error instanceof ApiError) ||
    error.status !== 409 ||
    !error.payload ||
    typeof error.payload !== 'object' ||
    !('current' in error.payload)
  )
    return null
  const current = error.payload.current
  return current && typeof current === 'object' && 'id' in current && 'revision' in current && 'markdown' in current
    ? (current as KnowledgePage)
    : null
}
export function useKnowledgeDraft(pageId: string, onSaved: () => void) {
  const [page, setPage] = useState<KnowledgePage | null>(null)
  const [draft, setDraft] = useState<KnowledgeDraft | null>(null)
  const [status, setStatus] = useState('Carregando…')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<KnowledgePage | null>(null)
  const current = useRef<KnowledgeDraft | null>(null)
  const saved = useRef<KnowledgePage | null>(null)
  const busy = useRef(false)
  const alive = useRef(true)
  const conflicted = useRef(false)
  const notify = useRef(onSaved)
  notify.current = onSaved
  const dirty = () =>
    !!current.current &&
    !!saved.current &&
    (current.current.title !== saved.current.title || current.current.markdown !== saved.current.markdown)
  const update = useCallback(
    (patch: Partial<KnowledgeDraft>) => {
      if (!current.current) return
      const next = { ...current.current, ...patch }
      current.current = next
      setDraft(next)
      setStatus('Alterações pendentes')
      try {
        persistDraft(pageId, next)
      } catch {
        setError('Não foi possível guardar o rascunho neste dispositivo. Mantenha a página aberta até salvar.')
      }
    },
    [pageId],
  )
  const save = useCallback(
    async (baseRevision?: number) => {
      if (busy.current || !current.current || !saved.current || (conflicted.current && baseRevision === undefined))
        return
      if (!dirty() && baseRevision === undefined) return
      const snapshot = { ...current.current, baseRevision: baseRevision ?? current.current.baseRevision }
      busy.current = true
      setStatus('Salvando…')
      setError(null)
      try {
        const next = await knowledgeApi.save(pageId, snapshot.title, snapshot.markdown, snapshot.baseRevision)
        saved.current = next
        const latest = current.current!
        current.current = { ...latest, baseRevision: next.revision }
        conflicted.current = false
        if (alive.current) {
          setPage(next)
          setDraft(current.current)
          setConflict(null)
          setStatus(dirty() ? 'Alterações pendentes' : 'Salvo')
          notify.current()
        }
        if (dirty()) persistDraft(pageId, current.current)
        else localStorage.removeItem(draftKey(pageId))
      } catch (cause) {
        const remote = conflictPage(cause)
        if (remote) {
          conflicted.current = true
          if (alive.current) setConflict(remote)
        }
        if (alive.current) {
          setError(cause instanceof Error ? cause.message : 'Falha ao salvar')
          setStatus('Não salvo')
        }
      } finally {
        busy.current = false
      }
    },
    [pageId],
  )
  useEffect(() => {
    alive.current = true
    const refresh = async () => {
      if (busy.current) return
      try {
        const remote = await knowledgeApi.read(pageId)
        if (!alive.current) return
        if (!saved.current) {
          const recovered = readDraft(pageId)
          current.current = recovered ?? {
            title: remote.title,
            markdown: remote.markdown,
            baseRevision: remote.revision,
          }
          saved.current = remote
          setPage(remote)
          setDraft(current.current)
          if (
            recovered &&
            recovered.baseRevision !== remote.revision &&
            (recovered.title !== remote.title || recovered.markdown !== remote.markdown)
          ) {
            conflicted.current = true
            setConflict(remote)
            setStatus('Rascunho recuperado · comparar versões')
          } else setStatus(recovered ? 'Rascunho recuperado' : 'Salvo')
          return
        }
        if (remote.revision === saved.current.revision) {
          if (remote.parentId !== saved.current.parentId) {
            saved.current = remote
            setPage(remote)
          }
          return
        }
        if (dirty()) {
          conflicted.current = true
          setConflict(remote)
          setStatus('Outra versão disponível')
          return
        }
        saved.current = remote
        current.current = { title: remote.title, markdown: remote.markdown, baseRevision: remote.revision }
        setPage(remote)
        setDraft(current.current)
        setStatus('Atualizado')
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : 'Falha ao carregar')
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 5_000)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      alive.current = false
      window.clearInterval(timer)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [pageId])
  useEffect(() => {
    if (!draft || conflict || error) return
    const timer = window.setTimeout(() => {
      void save()
    }, 700)
    return () => window.clearTimeout(timer)
  }, [draft, conflict, error, save])
  const useRemote = () => {
    if (!conflict) return
    saved.current = conflict
    current.current = { title: conflict.title, markdown: conflict.markdown, baseRevision: conflict.revision }
    conflicted.current = false
    setPage(conflict)
    setDraft(current.current)
    setConflict(null)
    setError(null)
    setStatus('Salvo')
    localStorage.removeItem(draftKey(pageId))
  }
  return {
    page,
    draft,
    status,
    error,
    conflict,
    update,
    retry: () => save(),
    saveMerged: () => save(conflict?.revision),
    useRemote,
  }
}
