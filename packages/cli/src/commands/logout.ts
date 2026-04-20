import { clearCredentials, loadCredentials } from '../config.js'

export function cmdLogout() {
  const creds = loadCredentials()
  if (!creds) {
    console.log('Not logged in.')
    return
  }
  clearCredentials()
  const display = creds.email || creds.userId
  console.log(`Logged out (${display})`)
}
