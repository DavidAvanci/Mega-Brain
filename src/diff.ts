export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed'

export interface FileDiff {
  oldName: string
  newName: string
  status: FileStatus
  binary: boolean
  hasHunks: boolean
  additions: number
  deletions: number
  maxLine: number
  raw: string
}

const LANGS: Record<string, string> = {
  mjs: 'js',
  cjs: 'js',
  mts: 'ts',
  cts: 'ts',
  yml: 'yaml',
  htm: 'xml',
  html: 'xml',
  svg: 'xml',
  sh: 'bash',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  kt: 'kotlin',
}

export function fileLang(file: FileDiff): string {
  const ext = (file.newName || file.oldName).split('.').pop()?.toLowerCase() ?? ''
  return LANGS[ext] ?? ext ?? 'plaintext'
}

function headerPath(line: string): string {
  const path = line.slice(4).replace(/\t$/, '')
  if (path === '/dev/null') return ''
  return path.replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '')
}

function parseFile(chunk: string): FileDiff {
  let oldName = ''
  let newName = ''
  let renamed = false
  let added = false
  let deleted = false
  let binary = false
  let inHunk = false
  let additions = 0
  let deletions = 0
  let maxLine = 0
  for (const line of chunk.split('\n')) {
    if (line.startsWith('@@ ')) {
      inHunk = true
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (header) {
        const [, oldStart, oldCount, newStart, newCount] = header
        maxLine = Math.max(maxLine, +oldStart + +(oldCount ?? 1), +newStart + +(newCount ?? 1))
      }
    } else if (inHunk) {
      if (line.startsWith('+')) additions++
      else if (line.startsWith('-')) deletions++
    } else if (line.startsWith('--- ')) oldName = headerPath(line)
    else if (line.startsWith('+++ ')) newName = headerPath(line)
    else if (line.startsWith('rename from ')) [renamed, oldName] = [true, line.slice(12)]
    else if (line.startsWith('rename to ')) newName = line.slice(10)
    else if (line.startsWith('new file mode')) added = true
    else if (line.startsWith('deleted file mode')) deleted = true
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) binary = true
  }
  if (!oldName && !newName) {
    const match = /^diff --git "?a\/(.+?)"? "?b\//.exec(chunk)
    if (match) oldName = newName = match[1]
  }
  const status: FileStatus =
    added || (!oldName && newName) ? 'added' : deleted || (oldName && !newName) ? 'deleted' : renamed ? 'renamed' : 'modified'
  if (status === 'added') oldName = ''
  if (status === 'deleted') newName = ''
  return { oldName, newName, status, binary, hasHunks: inHunk, additions, deletions, maxLine, raw: chunk }
}

export function parseDiff(raw: string): FileDiff[] {
  return raw
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith('diff --git '))
    .map(parseFile)
}
