import { describe, expect, it } from 'vitest'
import { fileLang, parseDiff } from './diff'

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index e1d4871..3bd3ee0 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
`

const ADDED = `diff --git a/novo.ts b/novo.ts
new file mode 100644
index 0000000..f36673f
--- /dev/null
+++ b/novo.ts
@@ -0,0 +1 @@
+const a = 1
`

const DELETED = `diff --git a/velho.js b/velho.js
deleted file mode 100644
index f36673f..0000000
--- a/velho.js
+++ /dev/null
@@ -1 +0,0 @@
-const a = 1
`

const RENAMED = `diff --git a/antes.ts b/depois.ts
similarity index 100%
rename from antes.ts
rename to depois.ts
`

const BINARY = `diff --git a/logo.png b/logo.png
index 123abc..456def 100644
Binary files a/logo.png and b/logo.png differ
`

describe('parseDiff', () => {
  it('separa um diff multi-arquivo preservando o chunk de cada um', () => {
    const files = parseDiff(MODIFIED + ADDED + DELETED)
    expect(files.map((f) => f.newName || f.oldName)).toEqual(['src/app.ts', 'novo.ts', 'velho.js'])
    expect(files.map((f) => f.raw)).toEqual([MODIFIED, ADDED, DELETED])
  })

  it('extrai status, nomes e contagens', () => {
    const [modified] = parseDiff(MODIFIED)
    expect(modified).toMatchObject({
      oldName: 'src/app.ts',
      newName: 'src/app.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      hasHunks: true,
      binary: false,
    })
    expect(parseDiff(ADDED)[0]).toMatchObject({ oldName: '', newName: 'novo.ts', status: 'added' })
    expect(parseDiff(DELETED)[0]).toMatchObject({ oldName: 'velho.js', newName: '', status: 'deleted' })
  })

  it('detecta rename sem hunks', () => {
    expect(parseDiff(RENAMED)[0]).toMatchObject({
      oldName: 'antes.ts',
      newName: 'depois.ts',
      status: 'renamed',
      hasHunks: false,
    })
  })

  it('detecta arquivo binário', () => {
    expect(parseDiff(BINARY)[0]).toMatchObject({
      oldName: 'logo.png',
      newName: 'logo.png',
      binary: true,
      hasHunks: false,
    })
  })

  it('não conta os headers ---/+++ como remoções/adições', () => {
    const [added] = parseDiff(ADDED)
    expect(added.additions).toBe(1)
    expect(added.deletions).toBe(0)
  })

  it('calcula maxLine a partir do maior hunk', () => {
    const multiHunk = `diff --git a/src/app.ts b/src/app.ts
index e1d4871..3bd3ee0 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
@@ -3990,3 +3991,4 @@
 const x = 1
+const y = 2
 const z = 3
`
    expect(parseDiff(multiHunk)[0].maxLine).toBe(3995)
    expect(parseDiff(MODIFIED)[0].maxLine).toBe(5)
    expect(parseDiff(RENAMED)[0].maxLine).toBe(0)
  })

  it('ignora texto fora de chunks e diffs vazios', () => {
    expect(parseDiff('')).toEqual([])
    expect(parseDiff('warning: alguma coisa\n')).toEqual([])
  })
})

describe('fileLang', () => {
  it('mapeia extensões para os langs do highlighter', () => {
    const of = (name: string) => fileLang(parseDiff(MODIFIED)[0] && { ...parseDiff(MODIFIED)[0], newName: name })
    expect(of('a.tsx')).toBe('tsx')
    expect(of('a.mjs')).toBe('js')
    expect(of('a.yml')).toBe('yaml')
    expect(of('a.html')).toBe('xml')
  })
})
