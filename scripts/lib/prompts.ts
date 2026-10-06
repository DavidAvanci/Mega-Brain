import { readFileSync } from 'node:fs'
import { DEFAULT_PROMPTS, type PromptSettings } from '../../shared/domain/settings.ts'

export function megaBrainPrompt(key: keyof PromptSettings): string {
  const file = process.env.MEGA_BRAIN_SETTINGS_FILE
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as {
        prompts?: Partial<PromptSettings>
        smartDiffReviewPrompt?: string
      }
      const value = key === 'smartDiffReview' ? saved.prompts?.[key] ?? saved.smartDiffReviewPrompt : saved.prompts?.[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    } catch {}
  }
  return DEFAULT_PROMPTS[key]
}
