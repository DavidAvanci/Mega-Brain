import { expect, test } from 'vitest'
import { credentialsForEnvironment, LOCAL_BACKEND_TEST_EMAIL } from './testCredentials'

const configured = { email: 'foodies@foodies.com', password: '123456' }

test('usa a conta do banco local quando o backend principal é local', () => {
  expect(credentialsForEnvironment(configured, true)).toEqual({
    email: LOCAL_BACKEND_TEST_EMAIL,
    password: '123456',
  })
})

test('preserva a conta configurada quando o backend principal é remoto', () => {
  expect(credentialsForEnvironment(configured, false)).toEqual(configured)
})

test('continua sem login quando não há credenciais configuradas', () => {
  expect(credentialsForEnvironment(null, true)).toBeNull()
})
