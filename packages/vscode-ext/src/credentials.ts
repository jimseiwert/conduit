import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

interface StoredCredentials {
  token: string
  userId?: string
  email?: string
}

/**
 * Reads the user credentials stored by `conduit login` from ~/.conduit/credentials.json.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function readUserCredentials(): StoredCredentials | null {
  const credPath = path.join(
    process.env['CONDUIT_HOME'] ?? path.join(os.homedir(), '.conduit'),
    'credentials.json',
  )
  if (!fs.existsSync(credPath)) return null
  try {
    const raw = fs.readFileSync(credPath, 'utf8')
    const parsed = JSON.parse(raw) as { token?: string; userId?: string; email?: string }
    return parsed.token ? { token: parsed.token, userId: parsed.userId, email: parsed.email } : null
  } catch {
    return null
  }
}
