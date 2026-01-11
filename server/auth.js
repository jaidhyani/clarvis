import { randomBytes } from 'crypto'

const ENV_VAR_NAME = 'CLARVIS_PASSWORD'

let password = null
let wasGenerated = false

export function initPassword() {
  const envPassword = process.env[ENV_VAR_NAME]

  if (envPassword) {
    password = envPassword
    wasGenerated = false
  } else {
    password = randomBytes(16).toString('hex')
    wasGenerated = true
  }

  return { password, wasGenerated }
}

export function validatePassword(provided) {
  if (!password) {
    return false
  }
  return provided === password
}

export { ENV_VAR_NAME }
