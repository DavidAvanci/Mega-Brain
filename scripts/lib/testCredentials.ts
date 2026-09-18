export interface TestCredentials {
  email: string
  password: string
}

export const LOCAL_BACKEND_TEST_EMAIL = 'test@example.invalid'

export function credentialsForEnvironment(
  credentials: TestCredentials | null,
  localBackend: boolean,
): TestCredentials | null {
  if (!credentials || !localBackend) return credentials
  return { ...credentials, email: LOCAL_BACKEND_TEST_EMAIL }
}
