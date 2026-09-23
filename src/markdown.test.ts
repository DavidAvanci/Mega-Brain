import { describe, expect, it } from 'vitest'
import { countTasks, render } from './markdownFormat'

describe('countTasks', () => {
  it('counts only top-level items by state', () => {
    const text = ['- [x] a', '- [ ] b', '- [-] c', '- [!] d', '  - [x] nested', '- plain'].join('\n')
    expect(countTasks(text)).toEqual({ total: 4, done: 1, skipped: 1, failed: 1 })
  })
})

describe('render', () => {
  it('renders task states as icons', () => {
    const { html } = render('- [x] done\n- [-] skipped\n- [!] failed\n- [ ] open')
    expect(html).toContain('<i class="task done"></i>')
    expect(html).toContain('<i class="task skipped"></i>')
    expect(html).toContain('<i class="task failed"></i>')
    expect(html).toContain('<i class="task open"></i>')
  })

  it('turns metadata lines after the title into a definition list', () => {
    const { html } = render('# PLAN\nissue: ESTR-1\ntitle: X\nestimate: 2h\n\n## Resumo\ntexto')
    expect(html).toContain(
      '<dl class="meta"><div><dt>issue</dt><dd>ESTR-1</dd></div><div><dt>estimate</dt><dd>2h</dd></div></dl>',
    )
    expect(html).not.toContain('title: X')
  })

  it('bolds known nested labels', () => {
    const { html } = render('- [ ] item\n  - Pré-condição: algo\n  - Passos: x')
    expect(html).toContain('<strong>Pré-condição:</strong> algo')
  })

  it('collects an outline of h2 with unique ids', () => {
    const { html, outline } = render('## Riscos\n## Riscos\n### Sub')
    expect(outline).toEqual([
      { id: 'riscos', text: 'Riscos' },
      { id: 'riscos-1', text: 'Riscos' },
    ])
    expect(html).toContain('<h2 id="riscos-1">')
  })

  it('opens links in a new tab', () => {
    expect(render('[x](https://a.b)').html).toContain('target="_blank"')
  })

  it('escapes raw HTML and removes unsafe link and image protocols', () => {
    const { html } = render(
      '<img src=x onerror=alert(1)>\n\n[run](javascript:alert(1))\n\n![pixel](data:image/svg+xml,<svg>)',
    )
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:image')
    expect(html).toContain('pixel')
  })

  it('allows same-origin-relative and safe web links while preventing protocol-relative URLs', () => {
    const { html } = render('[relative](./file.md) [external](https://example.com) [bad](//example.com)')
    expect(html).toContain('href="./file.md"')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('href="//example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
