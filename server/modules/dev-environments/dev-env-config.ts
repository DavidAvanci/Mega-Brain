
export interface FrontendConfig {
  apiVar?: string
  clubeApiVar?: string
  script: string
  flavor: 'vite' | 'cra' | 'next'
  port: number
}

export const AGD = 'api-garcom-digital'
export const CLUBE = 'api-clube'
export const BACKEND_LIBS = new Set(['api-core', 'takeat-services'])
export const BACKEND_PORT = Number(process.env.DEVENV_BACKEND_PORT || 3333)
export const CLUBE_PORT = Number(process.env.DEVENV_CLUBE_PORT || 3334)
export const LOCAL_API = `http://localhost:${BACKEND_PORT}`
export const LOCAL_CLUBE_API = `http://localhost:${CLUBE_PORT}`

export const FRONTENDS: Readonly<Record<string, FrontendConfig>> = {
  'operation-takeat': {
    apiVar: 'VITE_OPERATION_API_URL',
    script: 'dev',
    flavor: 'vite',
    port: 3000,
  },
  'garcom-restaurant-dashboard': {
    apiVar: 'REACT_APP_API_URL',
    script: 'start',
    flavor: 'cra',
    port: 3000,
  },
  'manager-area': {
    apiVar: 'VITE_API_KEY',
    script: 'dev',
    flavor: 'vite',
    port: 5173,
  },
  'internal-dashboard': {
    apiVar: 'VITE_API_URL',
    clubeApiVar: 'VITE_API_CLUB_URL',
    script: 'dev',
    flavor: 'vite',
    port: 5180,
  },
  'garcom-digital-client': {
    apiVar: 'VITE_API_URL',
    script: 'start',
    flavor: 'vite',
    port: 5173,
  },
  'dashboard-takeat': { apiVar: 'VITE_API_URL', script: 'start', flavor: 'cra', port: 3000 },
  'new-delivery-takeat': { script: 'dev', flavor: 'next', port: 3000 },
}
