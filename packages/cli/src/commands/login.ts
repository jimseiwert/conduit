import * as http from 'node:http'
import * as child_process from 'node:child_process'
import { getDashboardUrl, saveCredentials } from '../config.js'

function openBrowser(url: string): void {
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'
  child_process.spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

function waitForCallback(port: number): Promise<{ token: string; userId: string; email: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      const token = url.searchParams.get('token')
      const userId = url.searchParams.get('userId')
      const email = url.searchParams.get('email') ?? ''

      if (token && userId) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<html><body style="font-family:sans-serif;max-width:500px;margin:60px auto;text-align:center">` +
          `<h2>Logged in!</h2><p>You can close this tab and return to your terminal.</p></body></html>`
        )
        server.close()
        resolve({ token, userId, email })
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Missing token or userId')
      }
    })

    server.on('error', reject)
    server.listen(port, '127.0.0.1')

    setTimeout(() => {
      server.close()
      reject(new Error('Login timed out after 5 minutes. Please try again.'))
    }, 5 * 60 * 1000)
  })
}

export async function cmdLogin(args: { dashboard?: string }) {
  const dashboardUrl = (args.dashboard ?? getDashboardUrl()).replace(/\/$/, '')
  const callbackPort = await getFreePort()
  const callbackUrl = `http://localhost:${callbackPort}/callback`

  const loginUrl = `${dashboardUrl}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`

  console.log('Opening browser for authentication...')
  console.log(`If the browser does not open, visit:\n  ${loginUrl}`)

  openBrowser(loginUrl)

  let result: { token: string; userId: string; email: string }
  try {
    result = await waitForCallback(callbackPort)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }

  saveCredentials({
    token: result.token,
    userId: result.userId,
    email: result.email,
    dashboardUrl,
    createdAt: Date.now(),
  })

  const displayEmail = result.email || result.userId
  console.log(`Logged in as ${displayEmail}`)
}
