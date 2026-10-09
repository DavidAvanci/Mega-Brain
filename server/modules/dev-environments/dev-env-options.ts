import { activeRepositoryPath } from '../../repositories/catalog'
import { runScriptCommand } from '../../../scripts/lib/packageManager'
import type { DevEnvPreview, DevEnvProjectPreview, DevEnvStartOptions } from '../../../shared/domain/dev-environments'
import { AGD, CLUBE, FRONTENDS } from './dev-env-config'
import type { DevEnvPlan } from './dev-env'

export function parseDevEnvOptions(value: unknown): DevEnvStartOptions | undefined {
  if (value === undefined) return undefined
  if (
    !value ||
    typeof value !== 'object' ||
    !('projects' in value) ||
    !Array.isArray(value.projects) ||
    !('docker' in value) ||
    typeof value.docker !== 'boolean'
  ) {
    throw new Error('Configuração do ambiente dev inválida')
  }
  const projects = value.projects.map((project: unknown) => {
    if (
      !project ||
      typeof project !== 'object' ||
      !('repo' in project) ||
      typeof project.repo !== 'string' ||
      !('port' in project) ||
      typeof project.port !== 'number' ||
      !Number.isInteger(project.port) ||
      project.port < 1 ||
      project.port > 65535
    ) {
      throw new Error('Selecione projetos com portas inteiras entre 1 e 65535')
    }
    return { repo: project.repo, port: project.port }
  })
  if (!projects.length) throw new Error('Selecione pelo menos um projeto')
  if (new Set(projects.map((project) => project.repo)).size !== projects.length)
    throw new Error('Projeto duplicado na seleção')
  if (new Set(projects.map((project) => project.port)).size !== projects.length)
    throw new Error('Use uma porta diferente para cada projeto selecionado')
  return { projects, docker: value.docker }
}

// Backend changes can be tested alone or alongside a registered frontend.
export function addOptionalFrontends(plan: DevEnvPlan, catalogFile: string): void {
  if ((!plan.backend && !plan.clube) || plan.fronts.length || plan.apps.some((app) => app.kind === 'frontend')) return
  for (const [repo, config] of Object.entries(FRONTENDS)) {
    try {
      const dir = activeRepositoryPath(repo, catalogFile)
      plan.fronts.push({ repo, dir, canonical: dir, source: 'master', config, preferred: config.port })
    } catch {
      /* Only registered, active repositories are available. */
    }
  }
}

export function devEnvPreview(plan: DevEnvPlan, previous?: DevEnvStartOptions): DevEnvPreview {
  const projects: DevEnvProjectPreview[] = []
  const add = (project: Omit<DevEnvProjectPreview, 'selected'>, selected = true) => {
    const saved = previous?.projects.find((item) => item.repo === project.repo)
    const port = saved?.port ?? project.port
    projects.push({
      ...project,
      port,
      selected: previous ? Boolean(saved) : selected,
      ...(project.services
        ? {
            services: project.services.map((service) => ({
              ...service,
              port: service.name === 'external-api' ? port : service.port,
            })),
          }
        : {}),
    })
  }
  for (const [repo, app] of [
    [AGD, plan.backend],
    [CLUBE, plan.clube],
  ] as const) {
    if (!app) continue
    const command = runScriptCommand(app.dir, 'dev')
    add({
      repo,
      kind: 'backend',
      source: 'createWorktree' in app && app.createWorktree ? 'master' : 'worktree',
      directory: app.dir,
      port: app.port,
      command: [command.cmd, ...command.args].join(' '),
    })
  }
  for (const app of plan.apps) {
    const command = app.command
    add({
      repo: app.repo,
      kind: app.kind,
      source: 'worktree',
      directory: app.dir,
      port: app.preferred,
      command: [command.cmd, ...command.args].join(' '),
      services: app.services?.map((service) => ({ ...service })),
    })
  }
  for (const front of plan.fronts) {
    const command = runScriptCommand(front.dir, front.config.script)
    add(
      {
        repo: front.repo,
        kind: 'frontend',
        source: front.source,
        directory: front.dir,
        port: front.preferred,
        command: [command.cmd, ...command.args].join(' '),
      },
      front.source === 'worktree',
    )
  }
  // Avoid overlapping default frontend ports without overriding saved choices.
  if (!previous) {
    const used = new Set<number>()
    for (const project of projects.filter((item) => item.selected)) {
      while (project.kind === 'frontend' && used.has(project.port) && project.port < 65535) project.port++
      used.add(project.port)
    }
  }
  return {
    projects,
    docker: previous?.docker ?? plan.docker,
    platform: process.platform,
    warnings: plan.warnings,
    dockerContainers: [
      ...new Set([
        ...(plan.backend ? ['takeat_db', 'takeat_redis'] : []),
        ...(plan.clube ? ['database_clube_clientes', 'takeat_redis'] : []),
      ]),
    ],
  }
}

export function selectDevEnvProjects(plan: DevEnvPlan, options: DevEnvStartOptions): DevEnvPlan {
  const known = new Set([
    ...(plan.backend ? [AGD] : []),
    ...(plan.clube ? [CLUBE] : []),
    ...plan.apps.map((app) => app.repo),
    ...plan.fronts.map((front) => front.repo),
  ])
  for (const project of options.projects) {
    if (!known.has(project.repo)) throw new Error(`Projeto indisponível neste ambiente: ${project.repo}`)
  }
  const ports = new Map(options.projects.map((project) => [project.repo, project.port]))
  const backend = plan.backend && ports.has(AGD) ? { ...plan.backend, port: ports.get(AGD)! } : undefined
  const clube = plan.clube && ports.has(CLUBE) ? { ...plan.clube, port: ports.get(CLUBE)! } : undefined
  return {
    ...plan,
    backend,
    clube,
    localBackend: Boolean(backend),
    localClube: Boolean(clube),
    libs: backend ? plan.libs : [],
    docker: options.docker,
    fixedPorts: true,
    apps: plan.apps.filter((app) => ports.has(app.repo)).map((app) => ({ ...app, preferred: ports.get(app.repo)! })),
    fronts: plan.fronts
      .filter((front) => ports.has(front.repo))
      .map((front) => ({ ...front, preferred: ports.get(front.repo)! })),
  }
}
