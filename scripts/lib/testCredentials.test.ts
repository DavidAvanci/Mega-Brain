import { expect, test } from 'vitest'
import { credentialsFromEnvironment } from './testCredentials'

const configured = { TEST_LOGIN_EMAIL: 'tester@example.invalid', TEST_LOGIN_PASSWORD: 'fake-password' }

test('lê credenciais de teste configuradas no ambiente', () => {
  expect(credentialsFromEnvironment(configured)).toEqual({ email: 'tester@example.invalid', password: 'fake-password' })
})

test('não retorna credenciais incompletas', () => {
  expect(credentialsFromEnvironment({ TEST_LOGIN_EMAIL: 'tester@example.invalid' })).toBeNull()
})
