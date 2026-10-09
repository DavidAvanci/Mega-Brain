import { expect, test } from 'vitest'
import { BoundedCache } from './bounded-cache'

test('overflow preserves recently accessed entries and replaces existing keys', () => {
  const cache = new BoundedCache<string, number>(2)
  cache.set('a', 1)
  cache.set('b', 2)
  expect(cache.get('a')).toBe(1)
  cache.set('c', 3)
  expect(cache.get('b')).toBeUndefined()
  cache.set('a', 4)
  expect(cache.get('c')).toBe(3)
  expect(cache.get('a')).toBe(4)
})

test('pruning expires abandoned entries without removing still-valid values', () => {
  const cache = new BoundedCache<string, { expires: number }>(3)
  cache.set('old', { expires: 10 })
  cache.set('recent', { expires: 30 })
  cache.prune((entry) => entry.expires <= 20)
  expect(cache.get('old')).toBeUndefined()
  expect(cache.get('recent')).toEqual({ expires: 30 })
})
