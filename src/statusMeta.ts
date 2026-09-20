import {
  BlueprintIcon,
  CodeIcon,
  EyeIcon,
  FlaskConicalIcon,
  GitPullRequestIcon,
  HourglassIcon,
  InboxIcon,
  Rocket01Icon,
  ServerIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import type { Status } from '../shared/domain/cards'

interface StatusMeta {
  icon: IconSvgElement
  accent: string
  iconColor: string
}

export const STATUS_META: Record<Status, StatusMeta> = {
  'a-fazer': {
    icon: InboxIcon,
    accent: 'border-t-sky-500 dark:border-t-sky-400',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  planejando: {
    icon: BlueprintIcon,
    accent: 'border-t-sky-500 dark:border-t-sky-400',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  'revisao-de-plano': {
    icon: EyeIcon,
    accent: 'border-t-sky-500 dark:border-t-sky-400',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  desenvolvendo: {
    icon: CodeIcon,
    accent: 'border-t-violet-500 dark:border-t-violet-400',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  'auto-testing': {
    icon: FlaskConicalIcon,
    accent: 'border-t-violet-500 dark:border-t-violet-400',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  'code-review': {
    icon: GitPullRequestIcon,
    accent: 'border-t-violet-500 dark:border-t-violet-400',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  staging: {
    icon: ServerIcon,
    accent: 'border-t-cyan-500 dark:border-t-cyan-400',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
  },
  'aguardando-deploy': {
    icon: HourglassIcon,
    accent: 'border-t-yellow-500 dark:border-t-yellow-400',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
  },
  producao: {
    icon: Rocket01Icon,
    accent: 'border-t-emerald-500 dark:border-t-emerald-400',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
}

export const STATUS_GROUPS: { label: string; statuses: Status[] }[] = [
  { label: 'Plano', statuses: ['a-fazer', 'planejando', 'revisao-de-plano'] },
  { label: 'Execução', statuses: ['desenvolvendo', 'auto-testing', 'code-review'] },
  { label: 'Entrega', statuses: ['staging', 'aguardando-deploy', 'producao'] },
]
