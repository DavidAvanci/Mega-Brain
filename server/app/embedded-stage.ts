export type EmbeddedStageName = 'run-task-checklist' | 'run-test-checklist' | 'stage-task' | 'master-pr-task'

export type EmbeddedStageLoader = (stage: EmbeddedStageName) => Promise<void>

const imports: Record<EmbeddedStageName, () => Promise<void>> = {
  'run-task-checklist': () => import('../../scripts/commands/dev-stage.ts').then((module) => module.runDevStage()),
  'run-test-checklist': () => import('../../scripts/commands/test-stage.ts').then((module) => module.runTestStage()),
  'stage-task': () => import('../../scripts/commands/stage.ts').then((module) => module.runStagingStage()),
  'master-pr-task': () => import('../../scripts/commands/master-pr.ts').then((module) => module.runMasterPrStage()),
}

/** Dispatches the internal stage selected by the child-process environment. */
export async function runEmbeddedStage(
  stage: string,
  load: EmbeddedStageLoader = (name) => imports[name](),
): Promise<void> {
  if (!Object.hasOwn(imports, stage)) throw new Error(`Etapa interna desconhecida: ${stage}`)
  await load(stage as EmbeddedStageName)
}
