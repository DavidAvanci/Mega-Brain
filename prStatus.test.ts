import { expect, test } from 'vitest'
import { createPrTracker } from './prStatus'
import type { PrState } from './src/types'

function tracker(responses: Record<string, PrState | undefined>) {
  const fetched: string[] = []
  const track = createPrTracker(async (url) => {
    fetched.push(url)
    return responses[url]
  })
  return { track, fetched }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('descobre o estado em background e cacheia', async () => {
  const { track, fetched } = tracker({ 'https://github.com/x/1': 'merged', 'https://github.com/x/2': 'open' })
  const urls = ['https://github.com/x/1', 'https://github.com/x/2', 'branch-sem-url']

  expect(track(urls, 0)).toEqual({})
  expect(fetched).toEqual(['https://github.com/x/1', 'https://github.com/x/2'])
  await flush()

  expect(track(urls, 1000)).toEqual({ 'https://github.com/x/1': 'merged', 'https://github.com/x/2': 'open' })
  expect(fetched).toHaveLength(2)
})

test('merged é terminal, open re-checa após o TTL', async () => {
  const responses: Record<string, PrState | undefined> = { 'https://github.com/x/1': 'open' }
  const { track, fetched } = tracker(responses)
  const urls = ['https://github.com/x/1']

  track(urls, 0)
  await flush()
  expect(track(urls, 30_000)).toEqual({ 'https://github.com/x/1': 'open' })
  expect(fetched).toHaveLength(1)

  responses['https://github.com/x/1'] = 'merged'
  track(urls, 61_000)
  await flush()
  expect(track(urls, 62_000)).toEqual({ 'https://github.com/x/1': 'merged' })
  expect(fetched).toHaveLength(2)

  expect(track(urls, 200_000)).toEqual({ 'https://github.com/x/1': 'merged' })
  expect(fetched).toHaveLength(2)
})

test('falha na consulta mantém o último estado conhecido', async () => {
  const responses: Record<string, PrState | undefined> = { 'https://github.com/x/1': 'open' }
  const { track, fetched } = tracker(responses)
  const urls = ['https://github.com/x/1']

  track(urls, 0)
  await flush()
  responses['https://github.com/x/1'] = undefined
  track(urls, 61_000)
  await flush()

  expect(track(urls, 62_000)).toEqual({ 'https://github.com/x/1': 'open' })
  expect(fetched).toHaveLength(2)
})

test('não dispara consulta duplicada enquanto uma está pendente', () => {
  let resolveFetch: (state: PrState) => void = () => {}
  const fetched: string[] = []
  const track = createPrTracker((url) => {
    fetched.push(url)
    return new Promise((resolve) => (resolveFetch = resolve))
  })
  const urls = ['https://github.com/x/1']

  track(urls, 0)
  track(urls, 61_000)
  expect(fetched).toHaveLength(1)
  resolveFetch('merged')
})
