import { expect, test } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import { secureListenOptions } from './listener'

test('accepts only loopback listener options', () => {
  const config = loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-listener' })
  expect(secureListenOptions(config, { port: 0 })).toEqual({ host: '127.0.0.1', port: 0 })
  expect(() => secureListenOptions(config, { host: '0.0.0.0' })).toThrow('apenas host 127.0.0.1')
})
