import type { FlowLevel } from '../../shared/domain/cards'
import { CARD_FILES, checklistProgress, planningProgress, type StageProgress } from './card-artifacts'
import type { CardData } from './card-record'

export interface Stage {
  name: string
  status: string
  next?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  model?: string
  prompt?: (card: CardData) => string
  script?: string
  progress: (path: string, startedAt?: string, flow?: FlowLevel) => StageProgress
}

const TASK_CHECKLIST_SCOPE = [
  'Regra obrigatória para TASK-CHECKLIST.md: inclua somente ações de implementação.',
  'Não crie tasks de testes de qualquer tipo, criação ou alteração de arquivos de teste, validação, conferência, QA, smoke test, revisão visual, screenshots ou verificações manuais/automatizadas.',
  'Toda atividade de teste ou verificação pertence exclusivamente à TEST-CHECKLIST.md quando esse artefato fizer parte do fluxo; nos demais fluxos, apenas não a inclua na TASK-CHECKLIST.md.',
  'Cada item deve ser uma entrega pequena e verificável. Divida páginas extensas em estrutura, filtros, ações e integração; dê a cada parte um critério de conclusão próprio e deps explícitas. Itens substituídos devem ser riscados, com os novos itens dependentes preservando o histórico.',
  'Orçamento obrigatório do executor de desenvolvimento: cada item deve caber em no máximo 40 turns. Planeje para concluir confortavelmente dentro desse orçamento; se estimar mais, decomponha em itens menores, independentes quando possível, e conecte-os com deps. Nunca declare turns: acima de 40.',
  'Quando o fluxo gerar TEST-CHECKLIST.md, cada cenário também deve caber no executor de testes (máximo de 60 turns); se exceder, divida-o em cenários menores. Nunca declare turns: acima de 60 nesse arquivo.',
  'Declare arquivos compartilhados (helpers, exports e rotas) em files para serializar itens que os alterem. Para pré-condições use requires: e para arquivos novos use creates:, nunca trate uma criação prevista como requisito existente.',
  'Quando uma migração ou base for obrigatória, registre em card.json requiredBases por repositório e use deps no item; não dependa só da descrição. Limites específicos podem ser declarados como turns:, timeoutMin: e attempts:.',
]

function planningPrompt(card: CardData): string {
  const task = `${card.title}${card.description ? `\n\n${card.description}` : ''}`
  if (card.flow === 'simples') {
    return [
      `/task-planning ${task}`,
      '',
      'Fluxo SIMPLES (obrigatório): gere somente TASK-CHECKLIST.md.',
      'Não crie nem altere PLAN.md ou TEST-CHECKLIST.md.',
      'A TASK-CHECKLIST.md deve ser autocontida e trazer em cada item todo o contexto necessário para a implementação.',
      ...TASK_CHECKLIST_SCOPE,
    ].join('\n')
  }
  if (card.flow === 'medio') {
    return [
      `/task-planning ${task}`,
      '',
      'Fluxo MÉDIO (obrigatório): gere somente PLAN.md e TASK-CHECKLIST.md.',
      'Não crie nem altere TEST-CHECKLIST.md.',
      ...TASK_CHECKLIST_SCOPE,
    ].join('\n')
  }
  return [`/task-planning ${task}`, '', ...TASK_CHECKLIST_SCOPE].join('\n')
}

export const STAGES: Stage[] = [
  {
    name: 'task-planning',
    status: 'planejando',
    next: 'revisao-de-plano',
    effort: 'high',
    prompt: planningPrompt,
    progress: planningProgress,
  },
  {
    name: 'run-task-checklist',
    status: 'desenvolvendo',
    next: 'auto-testing',
    script: 'scripts/commands/dev-stage.ts',
    progress: checklistProgress('TASK-CHECKLIST.md'),
  },
  {
    name: 'run-test-checklist',
    status: 'auto-testing',
    next: 'code-review',
    script: 'scripts/commands/test-stage.ts',
    progress: checklistProgress('TEST-CHECKLIST.md'),
  },
  {
    name: 'stage-task',
    status: 'staging',
    script: 'scripts/commands/stage.ts',
    progress: () => ({ done: 0, total: 1, phase: 'Abrindo PRs de staging' }),
  },
  {
    name: 'master-pr-task',
    status: 'aguardando-deploy',
    script: 'scripts/commands/master-pr.ts',
    progress: () => ({ done: 0, total: 1, phase: 'Abrindo PRs de master' }),
  },
]

export function stageOwnedFiles(stage: Stage): string[] {
  if (stage.name === 'task-planning') return CARD_FILES
  if (stage.name === 'run-task-checklist') return ['TASK-CHECKLIST.md']
  if (stage.name === 'run-test-checklist') return ['TEST-CHECKLIST.md']
  return []
}

interface FlowProfile {
  next: Partial<Record<Stage['name'], string>>
}

export const FLOW_PROFILES: Record<FlowLevel, FlowProfile> = {
  simples: {
    next: {
      'task-planning': 'desenvolvendo',
      'run-task-checklist': 'code-review',
      'run-test-checklist': 'code-review',
    },
  },
  medio: {
    next: {
      'task-planning': 'revisao-de-plano',
      'run-task-checklist': 'code-review',
      'run-test-checklist': 'code-review',
    },
  },
  dificil: {
    next: {
      'task-planning': 'revisao-de-plano',
      'run-task-checklist': 'auto-testing',
      'run-test-checklist': 'code-review',
    },
  },
}

export function stageFor(status: string): Stage | undefined {
  return STAGES.find((stage) => stage.status === status)
}
