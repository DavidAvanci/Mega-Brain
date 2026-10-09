import { DirectorySettings } from '@/features/settings/DirectorySettings'
import { IdeSettings } from '@/features/settings/IdeSettings'
import { JiraSettings } from '@/features/settings/JiraSettings'
import { ProviderSettings } from '@/features/settings/ProviderSettings'
import { TerminalSettings } from '@/features/settings/TerminalSettings'
import { TriageSettings } from '@/features/settings/TriageSettings'
import type { EditorDiscovery } from '../shared/domain/settings'
import type { SettingsSectionProps } from '@/features/settings/settings-form'

export function GeneralSettingsForm(props: SettingsSectionProps & { initialEditors: EditorDiscovery }) {
  return (
    <div className="grid gap-6">
      <IdeSettings {...props} />
      <TerminalSettings {...props} />
      <DirectorySettings {...props} />
      <JiraSettings {...props} />
      <TriageSettings {...props} />
      <ProviderSettings {...props} />
    </div>
  )
}
