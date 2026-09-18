import { expect, test } from 'vitest'
import { parseChatSettings } from './service'

test('reads model and effort from the latest assistant response', () => {
  const transcript = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5' }, effort: 'low' }),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { model: 'claude-haiku-5' }, effort: 'high' }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5' }, effort: 'medium' }),
  ].join('\n')

  expect(parseChatSettings(transcript)).toEqual({ model: 'claude-opus-5', effort: 'medium' })
})
