import { expect, test } from 'vitest'
import { RequestTimeoutError, isLongRunningRoute, withTimeout } from './json-body'

test('identifies stream routes and applies ordinary route deadlines', async () => {
  expect(isLongRunningRoute('POST', '/api/chat/send')).toBe(true)
  expect(isLongRunningRoute('GET', '/api/chat/send')).toBe(false)
  await expect(withTimeout(new Promise<void>(() => {}), 1)).rejects.toBeInstanceOf(RequestTimeoutError)
})
