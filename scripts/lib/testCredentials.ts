export interface TestCredentials {
  email: string
  password: string
}

export function credentialsFromEnvironment(environment: Record<string, string>): TestCredentials | null {
  const email = environment.TEST_LOGIN_EMAIL?.trim()
  const password = environment.TEST_LOGIN_PASSWORD
  return email && password ? { email, password } : null
}
