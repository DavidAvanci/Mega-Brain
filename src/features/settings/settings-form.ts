import type { GeneralSettingsInput } from '../../../shared/domain/settings'

export type SettingsSectionProps = {
  value: GeneralSettingsInput
  onChange: (value: GeneralSettingsInput) => void
  disabled?: boolean
}
