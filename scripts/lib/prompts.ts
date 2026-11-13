import { readFileSync } from 'node:fs'
import { DEFAULT_PROMPTS, type PromptSettings } from '../../shared/domain/settings.ts'

export function megaBrainPrompt(key: keyof PromptSettings): string {
  const file = process.env.MEGA_BRAIN_SETTINGS_FILE
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as {
        prompts?: Partial<PromptSettings> & { smartDiffReview?: string }
      }
      const value = key === 'codeReview' ? saved.prompts?.codeReview ?? saved.prompts?.smartDiffReview : saved.prompts?.[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    } catch {}
  }
  return DEFAULT_PROMPTS[key]
}
