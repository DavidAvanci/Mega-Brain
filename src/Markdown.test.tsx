// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Markdown } from './Markdown'

const text = '## Primeira\nTexto\n\n## Segunda\nTexto\n\n## Terceira\nTexto'
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  host.dataset.slot = 'tabs-content'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('sumário volta à posição original de uma seção cujo título está sticky', async () => {
  await act(async () => root.render(<Markdown text={text} outline />))
  host.scrollTop = 500
  const scrollTo = vi.fn()
  host.scrollTo = scrollTo
  const heading = host.querySelector<HTMLElement>('#primeira')!
  heading.style.position = 'sticky'
  host.getBoundingClientRect = () => ({ top: 10 }) as DOMRect
  heading.getBoundingClientRect = () => ({ top: heading.style.position === 'static' ? -300 : 10 }) as DOMRect

  await act(async () => host.querySelector<HTMLButtonElement>('nav button')!.click())

  expect(scrollTo).toHaveBeenCalledWith({ top: 190, behavior: 'smooth' })
  expect(heading.style.position).toBe('sticky')
})

test('atualizar o modal com o mesmo plano preserva os elementos e a rolagem', async () => {
  await act(async () => root.render(<Markdown text={text} outline />))
  const heading = host.querySelector('#primeira')
  host.scrollTop = 500

  await act(async () => root.render(<Markdown text={text} outline />))

  expect(host.querySelector('#primeira')).toBe(heading)
  expect(host.scrollTop).toBe(500)
})
