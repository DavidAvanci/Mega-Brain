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
  highlight: string
}

export const STATUS_META: Record<Status, StatusMeta> = {
  'a-fazer': {
    icon: InboxIcon,
    accent: 'border-t-[var(--status-1)]',
    iconColor: 'text-[var(--status-1)]',
    highlight: 'bg-[var(--status-1)]',
  },
  planejando: {
    icon: BlueprintIcon,
    accent: 'border-t-[var(--status-2)]',
    iconColor: 'text-[var(--status-2)]',
    highlight: 'bg-[var(--status-2)]',
  },
  'revisao-de-plano': {
    icon: EyeIcon,
    accent: 'border-t-[var(--status-3)]',
    iconColor: 'text-[var(--status-3)]',
    highlight: 'bg-[var(--status-3)]',
  },
  desenvolvendo: {
    icon: CodeIcon,
    accent: 'border-t-[var(--status-4)]',
    iconColor: 'text-[var(--status-4)]',
    highlight: 'bg-[var(--status-4)]',
  },
  'auto-testing': {
    icon: FlaskConicalIcon,
    accent: 'border-t-[var(--status-5)]',
    iconColor: 'text-[var(--status-5)]',
    highlight: 'bg-[var(--status-5)]',
  },
  'code-review': {
    icon: GitPullRequestIcon,
    accent: 'border-t-[var(--status-6)]',
    iconColor: 'text-[var(--status-6)]',
    highlight: 'bg-[var(--status-6)]',
  },
  staging: {
    icon: ServerIcon,
    accent: 'border-t-[var(--status-7)]',
    iconColor: 'text-[var(--status-7)]',
    highlight: 'bg-[var(--status-7)]',
  },
  'aguardando-deploy': {
    icon: HourglassIcon,
    accent: 'border-t-[var(--status-8)]',
    iconColor: 'text-[var(--status-8)]',
    highlight: 'bg-[var(--status-8)]',
  },
  producao: {
    icon: Rocket01Icon,
    accent: 'border-t-[var(--status-9)]',
    iconColor: 'text-[var(--status-9)]',
    highlight: 'bg-[var(--status-9)]',
  },
}

export const STATUS_GROUPS: { label: string; statuses: Status[] }[] = [
  { label: 'Plano', statuses: ['a-fazer', 'planejando', 'revisao-de-plano'] },
  { label: 'Execução', statuses: ['desenvolvendo', 'auto-testing', 'code-review'] },
  { label: 'Entrega', statuses: ['staging', 'aguardando-deploy', 'producao'] },
]
