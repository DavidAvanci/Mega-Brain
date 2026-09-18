import { expect, test } from 'vitest'
import { prsCommentAdf, textCommentAdf } from './jira'

test('prsCommentAdf builds clickable links', () => {
  const adf: any = prsCommentAdf(
    'PRs Staging',
    { 'operation-takeat': 'https://github.com/takeat/operation-takeat/pull/1' },
    [['O que foi feito', 'Congela o restante.\n\nParcela sempre fecha.']],
  )
  expect(adf.content[0]).toEqual({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'PRs Staging' }] })
  const link = adf.content[1].content[0].content[0].content[0]
  expect(link.text).toBe('operation-takeat')
  expect(link.marks).toEqual([{ type: 'link', attrs: { href: 'https://github.com/takeat/operation-takeat/pull/1' } }])
  expect(adf.content[2].content[0].text).toBe('O que foi feito')
  expect(adf.content.slice(3).map((node: any) => node.content[0].text)).toEqual([
    'Congela o restante.',
    'Parcela sempre fecha.',
  ])
})

test('textCommentAdf', () => {
  const adf: any = textCommentAdf('Fora da janela de deploy.')
  expect(adf.content[0].content[0].text).toBe('Fora da janela de deploy.')
})
