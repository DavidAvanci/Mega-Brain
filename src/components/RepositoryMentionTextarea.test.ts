import { expect, test } from 'vitest'
import { mentionAtCursor, replaceMention } from './repository-mention-text'

test('finds only the mention at the cursor in a sentence with multiple mentions', () => {
  const text = 'Veja @api antes de @app e depois'
  expect(mentionAtCursor(text, text.indexOf('api') + 2)).toEqual({
    start: text.indexOf('@api'),
    end: text.indexOf('@api') + 4,
    query: 'ap',
  })
  expect(mentionAtCursor(text, text.indexOf('@app') + 4)).toEqual({
    start: text.indexOf('@app'),
    end: text.indexOf('@app') + 4,
    query: 'app',
  })
  expect(mentionAtCursor(text, text.length)).toBeNull()
})

test('does not turn email addresses or embedded at signs into mentions', () => {
  expect(mentionAtCursor('email a@api', 11)).toBeNull()
  expect(mentionAtCursor('foo@bar', 7)).toBeNull()
  expect(mentionAtCursor('use @', 5)).toEqual({ start: 4, end: 5, query: '' })
})

test('replaces the whole term at the middle cursor without touching another mention', () => {
  const text = 'Veja @api antes de @app depois'
  const match = mentionAtCursor(text, text.indexOf('api') + 2)!
  expect(replaceMention(text, match, 'api-core')).toEqual({
    value: 'Veja @api-core antes de @app depois',
    cursor: 'Veja @api-core'.length,
  })
})
