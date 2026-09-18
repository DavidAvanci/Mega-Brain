/**
 * Public boundary of the standalone backend.
 *
 * Do not export Vite middleware or frontend code from this directory.
 */
export { createServerRuntime, type ServerRuntime } from './runtime'
export {
  BACKEND_READY_PROTOCOL_VERSION,
  BACKEND_API_PROTOCOL_VERSION,
  createStandaloneServer,
  runFromCommandLine,
  startBackendLifecycle,
  type BackendLifecycleOptions,
  type BackendLogger,
  type BackendProcessStreams,
  type BackendReadyMessage,
  type BackendReadiness,
  type BackendReadinessProbe,
  type StandaloneServer,
  type StandaloneServerOptions,
} from './main'
export type { ApiHandler, ApiRequest, JsonResponse } from './contracts'
export { loadMegaBrainConfig, type MegaBrainConfig, type ExecutionMode } from './config'
