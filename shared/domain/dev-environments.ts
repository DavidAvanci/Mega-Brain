import type { DevEnvApp, DevEnvInfo } from './agents'

export type DevEnvStartOptions = {
  projects: { repo: string; port: number }[]
  docker: boolean
}

export type DevEnvProjectPreview = {
  repo: string
  kind: DevEnvApp['kind']
  source: DevEnvApp['source']
  directory: string
  command: string
  port: number
  selected: boolean
  services?: { name: string; port: number }[]
}

export type DevEnvPreview = {
  projects: DevEnvProjectPreview[]
  docker: boolean
  dockerContainers: string[]
  platform: string
  warnings: string[]
}

export type DevEnvLogs = {
  files: string[]
  file: string | null
  content: string
  truncated: boolean
}

export function devEnvDiagnosis(env: DevEnvInfo): { title: string; detail: string; nextStep: string } {
  const app =
    env.apps.find((project) => project.repo === env.failure?.repo) ??
    env.apps.find((project) => project.status === 'erro')
  const error = env.error ?? 'Erro ao iniciar o ambiente'
  const project = app?.repo ?? 'Um projeto'
  if (/Timeout esperando a porta/i.test(error))
    return {
      title: `${project} não respondeu${app?.port ? ` na porta ${app.port}` : ''}`,
      detail: 'O tempo limite terminou antes de a aplicação aceitar conexões.',
      nextStep:
        'Confira os logs para verificar dependências e configuração, ou peça ao agente para diagnosticar a inicialização.',
    }
  if (/porta .*ocupada/i.test(error))
    return {
      title: 'A porta escolhida já está em uso',
      detail: error,
      nextStep:
        'Escolha outra porta em Configurar ambiente ou peça ao agente para identificar o processo que está usando essa porta.',
    }
  if (/Docker:/i.test(error))
    return {
      title: 'Não foi possível iniciar os containers',
      detail: error,
      nextStep: 'Confira o Docker ou desative essa opção para usar o banco e o Redis já configurados.',
    }
  return {
    title: `${project} não iniciou`,
    detail: error,
    nextStep: 'Confira a etapa e os logs abaixo. O agente pode investigar o erro e tentar iniciar novamente.',
  }
}
