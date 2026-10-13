import { megaBrainPrompt } from './prompts.ts'

export function verificationPrompt(
  projects: { repo: string; path: string; files: string[] }[],
  reportPath: string,
  round: number,
): string {
  return [
    megaBrainPrompt('taskVerification'),
    `Item: VFY${round} — Verificar os projetos após a execução dos agentes`,
    'Grave somente o relatório JSON no caminho indicado. Use exatamente este formato: {"checks":[{"repo":"alias","name":"lint","command":"comando executado","status":"passed|failed|skipped","summary":"resumo curto"}],"failures":[{"repo":"alias","check":"nome exato da verificação","command":"comando","summary":"erro observado","task":"ação de correção","files":["caminho/relativo"]}]}. Toda verificação failed deve ter pelo menos uma entrada correspondente em failures. Use arrays vazios quando não houver registros.',
    `Projetos, paths e lista exata de arquivos alterados pelo card: ${JSON.stringify(projects)}`,
    `Relatório JSON: ${reportPath}`,
  ].join('\n\n')
}
