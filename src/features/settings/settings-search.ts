export type SettingsTab = 'general' | 'jira' | 'models' | 'ides' | 'terminal' | 'integrations' | 'prompts' | 'island'

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: 'Geral',
  jira: 'Jira',
  models: 'Modelos de execução',
  ides: 'IDEs',
  terminal: 'Shell e terminal',
  integrations: 'Integrações',
  prompts: 'Prompts',
  island: 'Ilha Dinâmica',
}

export type SettingsSearchEntry = {
  target: string
  tab: SettingsTab
  title: string
  description: string
  keywords: string
  platform?: 'desktop' | 'macOS'
}

const ENTRIES: SettingsSearchEntry[] = [
  {
    target: 'mode',
    tab: 'general',
    title: 'Modo de cores',
    description: 'Sistema, claro ou escuro.',
    keywords: 'aparência tema dark light automático',
  },
  {
    target: 'palette',
    tab: 'general',
    title: 'Paleta de cores',
    description: 'Escolha as cores do aplicativo.',
    keywords: 'aparência tema clássica Takeat oceano terracota frutas silvestres',
  },
  {
    target: 'typography',
    tab: 'general',
    title: 'Tipografia',
    description: 'Fontes e espaçamento do texto.',
    keywords: 'aparência tema JetBrains Mono Poppins editorial Georgia técnica',
  },
  {
    target: 'shape',
    tab: 'general',
    title: 'Formatos',
    description: 'Raio e forma dos cantos.',
    keywords: 'aparência tema clássico Takeat squircle suave angular arredondamento bordas',
  },
  {
    target: 'preset',
    tab: 'general',
    title: 'Presets de tema',
    description: 'Aplique cores, fontes e formatos em conjunto.',
    keywords: 'aparência clássico Takeat',
  },
  {
    target: 'startup',
    tab: 'general',
    title: 'Inicialização',
    description: 'Abrir ao iniciar o computador.',
    keywords: 'autostart login automático macOS Windows',
    platform: 'desktop',
  },
  {
    target: 'directories',
    tab: 'general',
    title: 'Diretórios',
    description: 'Workspace dos cards, pasta de worktrees e armazenamento do conhecimento.',
    keywords: 'caminho pastas arquivos git knowledge conhecimento catálogo catalog.json',
  },
  {
    target: 'flows',
    tab: 'general',
    title: 'Perfis de fluxo',
    description: 'Etapas e artefatos de cada nível de dificuldade.',
    keywords: 'simples médio difícil planejamento desenvolvimento review testes checklist',
  },
  {
    target: 'jira',
    tab: 'jira',
    title: 'Conexão com Jira',
    description: 'Site, e-mail e token da API.',
    keywords: 'integração credenciais autenticação sincronização status atlassian',
  },
  {
    target: 'provider',
    tab: 'models',
    title: 'Provedor de IA',
    description: 'Claude Code ou Codex.',
    keywords: 'modelos de execução agente CLI chatgpt',
  },
  {
    target: 'task-planning',
    tab: 'models',
    title: 'Modelo e esforço de planejamento',
    description: 'Modelo e raciocínio para criar planos e checklists.',
    keywords:
      'modelos de execução claude codex effort reasoning fast mode velocidade low medium high x-high max ultra fable opus sonnet haiku gpt',
  },
  {
    target: 'run-task-checklist',
    tab: 'models',
    title: 'Modelo e esforço de desenvolvimento',
    description: 'Modelo e raciocínio para executar as tarefas.',
    keywords:
      'modelos de execução claude codex effort reasoning fast mode velocidade low medium high x-high max ultra fable opus sonnet haiku gpt',
  },
  {
    target: 'codex-profiles',
    tab: 'models',
    title: 'Perfis do Codex',
    description: 'Contas, pastas e perfil padrão para novas execuções.',
    keywords: 'modelos de execução CODEX_HOME adicionar editar cor identificação',
  },
  {
    target: 'ides',
    tab: 'ides',
    title: 'Editor de código',
    description: 'IDE e executável usados para abrir os cards.',
    keywords: 'IDEs vscode visual studio cursor windsurf zed intellij webstorm detectar personalizado',
  },
  {
    target: 'terminal',
    tab: 'terminal',
    title: 'Terminal',
    description: 'Aplicativo usado para abrir os agentes.',
    keywords: 'shell macOS iTerm2 Windows WSL Linux automático personalizado executável',
  },
  {
    target: 'shell',
    tab: 'terminal',
    title: 'Shell',
    description: 'Ambiente de login para executar os agentes.',
    keywords: 'terminal zsh bash POSIX comando executável personalizado',
  },
  {
    target: 'triage',
    tab: 'integrations',
    title: 'Triagem de cards com Jev',
    description: 'Ativação, URL e chave da API TypeSafe.',
    keywords: 'integrações experimental análise credenciais token autenticação remover chave',
  },
  {
    target: 'prompt-taskPlanning',
    tab: 'prompts',
    title: 'Prompt de planejamento',
    description: 'Instruções para criar o plano e os checklists.',
    keywords: 'prompts claude codex task agente',
  },
  {
    target: 'prompt-taskItem',
    tab: 'prompts',
    title: 'Prompt de execução de tarefas',
    description: 'Instruções para implementar cada item do checklist.',
    keywords: 'prompts claude codex desenvolvimento task agente',
  },
  {
    target: 'prompt-testEnvironment',
    tab: 'prompts',
    title: 'Prompt de ambiente de testes',
    description: 'Instruções para preparar o ambiente local.',
    keywords: 'prompts claude codex agente',
  },
  {
    target: 'prompt-smartDiffReview',
    tab: 'prompts',
    title: 'Prompt de revisão Smart Diff',
    description: 'Instruções para revisar as alterações de código.',
    keywords: 'prompts claude codex review agente',
  },
  {
    target: 'island',
    tab: 'island',
    title: 'Ilha Dinâmica',
    description: 'Ativação, sons, tela e estilo da ilha.',
    keywords: 'monitor compacta detalhada agentes tarefas',
    platform: 'macOS',
  },
  {
    target: 'island-pet',
    tab: 'island',
    title: 'Mascote da ilha',
    description: 'Aparência, tamanho, animação e cores dos estados.',
    keywords: 'ilha dinâmica pet claude codex velocidade atividade',
    platform: 'macOS',
  },
  {
    target: 'island-behavior',
    tab: 'island',
    title: 'Interação da ilha',
    description: 'Perguntas automáticas, outros agentes e atividade atual.',
    keywords: 'ilha dinâmica comportamento linha compacta resposta',
    platform: 'macOS',
  },
  {
    target: 'island-dimensions',
    tab: 'island',
    title: 'Dimensões e texto da ilha',
    description: 'Ajuste o tamanho da ilha e dos textos.',
    keywords: 'ilha dinâmica largura altura fonte espaçamento',
    platform: 'macOS',
  },
]

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

export function searchSettings(query: string, platform: { desktop: boolean; macOS: boolean; codex?: boolean }) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return ENTRIES.filter((entry) => {
    if (entry.platform === 'desktop' && !platform.desktop) return false
    if (entry.platform === 'macOS' && !platform.macOS) return false
    if (entry.target === 'codex-profiles' && !platform.codex) return false
    const text = normalize(`${SETTINGS_TAB_LABELS[entry.tab]} ${entry.title} ${entry.description} ${entry.keywords}`)
    return words.every((word) => text.includes(word))
  })
}
