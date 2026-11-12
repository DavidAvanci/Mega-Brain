import type { Status } from './cards'

export const DEFAULT_JIRA_STATUS = 'READY TO DO'

export const JIRA_STATUS_BY_STATUS: Partial<Record<Status, string>> = {
  'a-fazer': DEFAULT_JIRA_STATUS,
  'revisao-de-plano': 'IDEIA',
  desenvolvendo: 'EM DESENVOLVIMENTO',
  'code-review': 'CODE REVIEW',
  staging: 'STAGING',
  'aguardando-deploy': 'AGUARDANDO DEPLOY',
  producao: 'PRODUÇÃO',
}
