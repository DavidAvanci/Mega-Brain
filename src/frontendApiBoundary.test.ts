import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const sourceDir = new URL('.', import.meta.url)

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = new URL(entry.name, directory)
      if (entry.isDirectory()) return sourceFiles(new URL(`${entry.name}/`, directory))
      return entry.isFile() &&
        /\.(?:ts|tsx)$/.test(entry.name) &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.test.tsx')
        ? [file]
        : []
    }),
  )
  return nested.flat()
}

describe('frontend API boundary', () => {
  it('keeps direct fetch calls inside the shared API client only', async () => {
    const files = await sourceFiles(sourceDir)
    const offenders = await Promise.all(
      files
        .filter((file) => !file.pathname.endsWith('/shared/api/api-client.ts'))
        .map(async (file) => ({ file, content: await readFile(file, 'utf8') })),
    )

    expect(
      offenders.filter(({ content }) => /(^|[^.$\w])fetch\s*\(/m.test(content)).map(({ file }) => file.pathname),
    ).toEqual([])
  })
})
