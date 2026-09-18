import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError, apiClient, bootstrapWebApiClient, configureApiClient } from './apiClient'

const encoder = new TextEncoder()

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('ApiClient', () => {
  it('keeps web paths relative and sends no auth token', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))
    const client = new ApiClient({ fetch })
    await client.json('/api/workspace?card=A%2FB')
    expect(fetch).toHaveBeenCalledWith('/api/workspace?card=A%2FB', expect.objectContaining({ headers: expect.any(Headers) }))
    expect(new Headers(fetch.mock.calls[0][1].headers).has('Authorization')).toBe(false)
  })

  it('preserves a desktop endpoint prefix and keeps bearer auth in request memory', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    const client = new ApiClient({ mode: 'desktop', baseUrl: 'http://127.0.0.1:4312/mega-brain/', token: 'ephemeral', fetch })
    await client.json('/api/items?x=1')
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:4312/mega-brain/api/items?x=1')
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer ephemeral')
  })

  it('parses JSON and text errors safely', async () => {
    const jsonClient = new ApiClient({ fetch: vi.fn().mockResolvedValue(new Response('{"error":"Nope"}', { status: 401, headers: { 'content-type': 'application/json' } })) })
    await expect(jsonClient.json('/api/x')).rejects.toMatchObject({ name: 'ApiError', status: 401, message: 'Nope' })
    const textClient = new ApiClient({ fetch: vi.fn().mockResolvedValue(new Response('Down', { status: 503, headers: { 'content-type': 'text/plain' } })) })
    await expect(textClient.json('/api/x')).rejects.toMatchObject({ name: 'ApiError', status: 503, message: 'Down' })
  })

  it('streams split SSE frames incrementally', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(stream(['data: {"delta":"he', 'llo"}\n\ndata: {"done":true}\n\n']), { headers: { 'content-type': 'text/event-stream' } }))
    const events: unknown[] = []
    await new ApiClient({ fetch }).sse('/api/chat', { onEvent: (event) => { events.push(event) } })
    expect(events).toEqual([{ delta: 'hello' }, { done: true }])
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Accept')).toBe('text/event-stream')
  })

  it('passes AbortSignal through to a streaming request', async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    const client = new ApiClient({ fetch })
    controller.abort()
    await expect(client.sse('/api/chat', { signal: controller.signal, onEvent: () => {} })).rejects.toThrow('Aborted')
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('has a controlled global configuration', () => {
    configureApiClient({ mode: 'desktop', baseUrl: 'http://127.0.0.1:3000', token: 'memory-only' })
    expect(apiClient()).toBeInstanceOf(ApiClient)
    expect(() => configureApiClient({ mode: 'desktop', baseUrl: 'http://127.0.0.1:3000' })).toThrow('session token')
    configureApiClient({ mode: 'web' })
  })

  it('synchronously resets desktop state to the deterministic web transport', async () => {
    configureApiClient({ mode: 'desktop', baseUrl: 'http://127.0.0.1:4312', token: 'desktop-only' })
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))
    const webClient = bootstrapWebApiClient(fetch)
    await apiClient().json('/api/workspace')

    expect(webClient).toBeInstanceOf(ApiClient)
    expect(fetch).toHaveBeenCalledWith('/api/workspace', expect.objectContaining({ headers: expect.any(Headers) }))
    expect(new Headers(fetch.mock.calls[0][1].headers).has('Authorization')).toBe(false)
  })

  it('does not retain a desktop token when web bootstrap runs again (HMR)', async () => {
    configureApiClient({ mode: 'desktop', baseUrl: 'http://127.0.0.1:4312', token: 'must-not-survive' })
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }))
    bootstrapWebApiClient(fetch)
    await apiClient().json('/api/coffee')

    expect(fetch.mock.calls[0][0]).toBe('/api/coffee')
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBeNull()
  })

  it('rejects web tokens and malformed paths', async () => {
    expect(() => new ApiClient({ token: 'no' })).toThrow('Web mode')
    await expect(new ApiClient().request('api/no-leading-slash')).rejects.toThrow('must start')
    expect(ApiError).toBeTypeOf('function')
  })
})
