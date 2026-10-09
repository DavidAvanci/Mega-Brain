import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
export function knowledgeEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, protocols: ['http', 'https', 'mailto'] },
    }),
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
  ]
}
