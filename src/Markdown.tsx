import { useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { render } from './markdownFormat'

const OUTLINE_MIN_SECTIONS = 3

export function Markdown({ text, outline = false }: { text: string; outline?: boolean }) {
  const rendered = useMemo(() => render(text), [text])
  const body = useRef<HTMLDivElement>(null)
  const showOutline = outline && rendered.outline.length >= OUTLINE_MIN_SECTIONS

  const jump = (id: string) => {
    body.current?.querySelector(`[id="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div className={cn('flex min-h-0 flex-1', showOutline && 'gap-6')}>
      {showOutline && (
        <nav className="sticky top-0 hidden w-40 shrink-0 self-start md:block">
          <p className="mb-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Seções</p>
          <ol className="flex flex-col gap-0.5 border-l">
            {rendered.outline.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => jump(entry.id)}
                  className="-ml-px block w-full truncate border-l border-transparent py-0.5 pl-2.5 text-left text-[11px] leading-snug text-muted-foreground hover:border-foreground hover:text-foreground"
                  title={entry.text}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div ref={body} className="markdown min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: rendered.html }} />
    </div>
  )
}
