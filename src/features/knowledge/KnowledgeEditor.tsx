import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Extension } from '@tiptap/core'
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion'
import Placeholder from '@tiptap/extension-placeholder'
import { HugeiconsIcon } from '@hugeicons/react'
import { TextBoldIcon, TextItalicIcon, Link01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Tip } from '@/Tip'
import { knowledgeEditorExtensions } from './editor-extensions'
import './knowledge.css'

type Block = { label: string; shortcut: string; apply: (editor: Editor) => void }
const blocks: Block[] = [
  {
    label: 'Texto',
    shortcut: '¶',
    apply: (editor) => {
      editor.chain().focus().setParagraph().run()
    },
  },
  ...([1, 2, 3] as const).map((level) => ({
    label: `Título ${level}`,
    shortcut: `H${level}`,
    apply: (editor: Editor) => {
      editor.chain().focus().toggleHeading({ level }).run()
    },
  })),
  {
    label: 'Lista com marcadores',
    shortcut: '•',
    apply: (editor) => {
      editor.chain().focus().toggleBulletList().run()
    },
  },
  {
    label: 'Lista numerada',
    shortcut: '1.',
    apply: (editor) => {
      editor.chain().focus().toggleOrderedList().run()
    },
  },
  {
    label: 'Lista de tarefas',
    shortcut: '☑',
    apply: (editor) => {
      editor.chain().focus().toggleTaskList().run()
    },
  },
  {
    label: 'Citação',
    shortcut: '❞',
    apply: (editor) => {
      editor.chain().focus().toggleBlockquote().run()
    },
  },
  {
    label: 'Bloco de código',
    shortcut: '</>',
    apply: (editor) => {
      editor.chain().focus().toggleCodeBlock().run()
    },
  },
  {
    label: 'Divisor',
    shortcut: '—',
    apply: (editor) => {
      editor.chain().focus().setHorizontalRule().run()
    },
  },
]
type Menu = { props: SuggestionProps<Block>; active: number }
export function KnowledgeEditor({ markdown, onChange }: { markdown: string; onChange: (markdown: string) => void }) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const slash = useMemo(
    () =>
      Extension.create({
        name: 'knowledgeSlash',
        addProseMirrorPlugins() {
          return [
            Suggestion<Block>({
              editor: this.editor,
              char: '/',
              startOfLine: true,
              items: ({ query }) =>
                blocks.filter((block) =>
                  block.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')),
                ),
              command: ({ editor, range, props }) => {
                editor.chain().focus().deleteRange(range).run()
                props.apply(editor)
              },
              render: () => {
                let current: SuggestionProps<Block> | null = null
                let active = 0
                return {
                  onStart: (props) => {
                    current = props
                    active = 0
                    setMenu({ props, active })
                  },
                  onUpdate: (props) => {
                    current = props
                    active = 0
                    setMenu({ props, active })
                  },
                  onExit: () => {
                    current = null
                    setMenu(null)
                  },
                  onKeyDown: ({ event }) => {
                    if (!current) return false
                    if (event.key === 'Escape') {
                      exitSuggestion(current.editor.view)
                      setMenu(null)
                      return true
                    }
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      active =
                        (active + (event.key === 'ArrowDown' ? 1 : current.items.length - 1)) %
                        Math.max(1, current.items.length)
                      setMenu({ props: current, active })
                      return true
                    }
                    if (event.key === 'Enter' && current.items[active]) {
                      current.command(current.items[active])
                      return true
                    }
                    return false
                  },
                }
              },
            }),
          ]
        },
      }),
    [],
  )
  const editor = useEditor({
    extensions: [
      ...knowledgeEditorExtensions(),
      Placeholder.configure({ placeholder: 'Escreva algo ou digite / para inserir um bloco…' }),
      slash,
    ],
    content: markdown,
    contentType: 'markdown',
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    editorProps: {
      attributes: {
        class: 'knowledge-editor',
        'aria-label': 'Conteúdo da página',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
  })
  useEffect(() => {
    if (editor && editor.getMarkdown() !== markdown)
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
  }, [editor, markdown])
  const position = menu?.props.clientRect?.()
  return (
    <div className="relative">
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu editor={editor} className="flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-md">
          <Tip label="Negrito (⌘/Ctrl B)">
            <Button
              variant={editor.isActive('bold') ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Negrito"
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <HugeiconsIcon icon={TextBoldIcon} />
            </Button>
          </Tip>
          <Tip label="Itálico (⌘/Ctrl I)">
            <Button
              variant={editor.isActive('italic') ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Itálico"
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <HugeiconsIcon icon={TextItalicIcon} />
            </Button>
          </Tip>
          <Tip label="Link">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Inserir link"
              onClick={() => {
                setLink(String(editor.getAttributes('link').href ?? ''))
                setLinkOpen(true)
              }}
            >
              <HugeiconsIcon icon={Link01Icon} />
            </Button>
          </Tip>
          {linkOpen && (
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                if (!link || /^(https?:\/\/|mailto:)/i.test(link)) {
                  const chain = editor.chain().focus().extendMarkRange('link')
                  if (link) chain.setLink({ href: link }).run()
                  else chain.unsetLink().run()
                  setLinkOpen(false)
                }
              }}
            >
              <input
                autoFocus
                aria-label="Endereço do link"
                placeholder="https://…"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                className="w-48 rounded border px-2 text-xs"
              />
              <Button size="xs" type="submit">
                Aplicar
              </Button>
            </form>
          )}
        </BubbleMenu>
      )}
      {menu && position && (
        <div
          role="listbox"
          aria-label="Inserir bloco"
          className="fixed z-50 max-h-80 w-64 overflow-auto rounded-lg border bg-popover p-1 shadow-lg"
          style={{
            left: Math.min(position.left, window.innerWidth - 270),
            top: Math.min(position.bottom + 6, window.innerHeight - 330),
          }}
        >
          {menu.props.items.length ? (
            menu.props.items.map((block, index) => (
              <button
                type="button"
                role="option"
                aria-selected={menu.active === index}
                key={block.label}
                className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm ${menu.active === index ? 'bg-accent' : 'hover:bg-accent'}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => menu.props.command(block)}
              >
                <span className="w-6 font-mono text-xs text-muted-foreground">{block.shortcut}</span>
                {block.label}
              </button>
            ))
          ) : (
            <p className="p-3 text-xs text-muted-foreground">Nenhum bloco encontrado</p>
          )}
        </div>
      )}
    </div>
  )
}
