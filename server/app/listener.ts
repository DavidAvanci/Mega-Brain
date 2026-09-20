import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { MegaBrainConfig } from '../config'

export interface LoopbackListenOverride {
  host?: string
  port?: number
}

export function secureListenOptions(
  config: MegaBrainConfig,
  override: LoopbackListenOverride | undefined,
): { host: '127.0.0.1'; port: number } {
  if (override?.host !== undefined && override.host !== '127.0.0.1') {
    throw new Error('O backend independente aceita apenas host 127.0.0.1')
  }
  const port = override?.port ?? config.server.port
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('A porta do backend deve estar entre 0 e 65535')
  }
  return { host: '127.0.0.1', port }
}

export function serverAddress(server: Server): AddressInfo {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('O backend ainda não está escutando em TCP')
  }
  return address
}

export function listenOnLoopback(server: Server, options: { host: '127.0.0.1'; port: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

export function closeListener(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
