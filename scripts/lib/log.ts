export function activity(name: string, description: string): void {
  process.stdout.write(
    `${JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name, input: { description } }] },
    })}\n`,
  )
  process.stderr.write(`[${new Date().toISOString()}] ${name}: ${description}\n`)
}

export function finish(ok: boolean, message?: string): void {
  if (message) process.stderr.write(`${message}\n`)
  process.stdout.write(
    `${JSON.stringify({ type: 'result', subtype: ok ? 'success' : 'error', is_error: !ok, result: message ?? '' })}\n`,
  )
}
