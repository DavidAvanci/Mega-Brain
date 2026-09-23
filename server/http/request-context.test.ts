import { expect, test } from 'vitest'
import { normalizeRequestHeaders, safeRoute } from './request-context'

test('normalizes multi-value headers and records only a safe pathname', () => {
  expect(normalizeRequestHeaders({ authorization: 'Bearer token', 'x-forwarded-for': ['a', 'b'] })).toEqual({
    authorization: 'Bearer token',
    'x-forwarded-for': 'a, b',
  })
  expect(safeRoute('/api/workspace?name=card')).toBe('/api/workspace')
  expect(safeRoute('http://%')).toBe('/')
})
