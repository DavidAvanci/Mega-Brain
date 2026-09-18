import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadMegaBrainConfig } from '../server/config.ts'
import { createCard } from '../server/workspace/card-folder.ts'
import { loadEnv, MEGA_ROOT } from './lib/env.ts'

const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    description: { type: 'string' },
    'description-file': { type: 'string' },
    flow: { type: 'string' },
  },
})

if (!values.title?.trim()) {
  console.error('Uso: npm run card:create -- --title "<título>" [--description "<texto>" | --description-file <arquivo>] [--flow simples|medio|dificil]')
  process.exit(1)
}

const description = values['description-file'] ? readFileSync(values['description-file'], 'utf8') : values.description
const root = resolve(MEGA_ROOT, loadMegaBrainConfig({ env: { ...loadEnv(), ...process.env } }).workspaceDir)
mkdirSync(root, { recursive: true })
const { folder, path } = createCard(root, { title: values.title, description, flow: values.flow })
console.log(JSON.stringify({ folder, path }))
