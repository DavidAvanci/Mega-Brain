// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { expect, test } from 'vitest'
import { knowledgeEditorExtensions } from './editor-extensions'
const expectedTypes = [
  'paragraph',
  'heading',
  'heading',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'bold',
  'link',
  'blockquote',
  'codeBlock',
  'horizontalRule',
]
const cases = [
  'Parágrafo simples.',
  '# Título 1',
  '## Título 2',
  '### Título 3',
  '- Primeiro\n- Segundo\n  - Filho',
  '1. Primeiro\n2. Segundo',
  '- [ ] Pendente\n- [x] Concluído',
  '**Negrito** e *itálico*',
  '[Link](https://example.com)',
  '> Citação',
  '```js\nconst n = 1\n```',
  '---',
]
test.each(cases.map((markdown, index) => ({ markdown, expectedType: expectedTypes[index] })))(
  'Markdown preserves editor structure after round trip: $markdown',
  ({ markdown, expectedType }) => {
    const editor = new Editor({ extensions: knowledgeEditorExtensions(), content: markdown, contentType: 'markdown' })
    const json = editor.getJSON()
    expect(JSON.stringify(json)).toContain(`"type":"${expectedType}"`)
    if (markdown.includes('*itálico*')) expect(JSON.stringify(json)).toContain('"type":"italic"')
    if (expectedType === 'taskList') expect(JSON.stringify(json)).toContain('"checked":true')
    const exported = editor.getMarkdown()
    const second = new Editor({ extensions: knowledgeEditorExtensions(), content: exported, contentType: 'markdown' })
    expect(second.getJSON()).toEqual(json)
    second.destroy()
    editor.destroy()
  },
)
