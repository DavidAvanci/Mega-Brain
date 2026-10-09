import type { DevEnvApp } from './agents'

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
}

export type DevEnvPreview = {
  projects: DevEnvProjectPreview[]
  docker: boolean
  dockerContainers: string[]
  platform: string
  warnings: string[]
}
