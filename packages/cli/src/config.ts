import * as fs from 'node:fs'
import * as path from 'node:path'
import * as dotenv from 'dotenv'
import { expand } from 'dotenv-expand'
import jwt from 'jsonwebtoken'

export interface TunnelConfig {
  slug: string
  port: number
  httpEnabled: boolean
}

export interface LoadedConfig {
  tunnel: TunnelConfig
  token: string | null
  userToken: string | null
  configPath: string
}

export class ConfigMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigMismatchError'
  }
}

export class ConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigNotFoundError'
  }
}

/**
 * Loads .env, .env.local, and .env.${NODE_ENV} files from cwd.
 * Later files override earlier ones.
 */
export function loadDotenv(cwd: string): void {
  const nodeEnv = process.env['NODE_ENV']

  const files = [
    path.join(cwd, '.env'),
    path.join(cwd, '.env.local'),
    ...(nodeEnv ? [path.join(cwd, `.env.${nodeEnv}`)] : []),
  ]

  for (const file of files) {
    if (fs.existsSync(file)) {
      const parsed = dotenv.config({ path: file, override: true })
      if (parsed.parsed) {
        expand({ parsed: parsed.parsed, processEnv: process.env as Record<string, string> })
      }
    }
  }
}

/**
 * Reads and parses the .tunnel config file.
 * Throws with clear message if file not found or invalid JSON.
 */
export function readTunnelConfig(configPath: string): TunnelConfig {
  if (!fs.existsSync(configPath)) {
    throw new ConfigNotFoundError(
      `Config file not found: ${configPath}\nRun \`snc start --slug <your-slug>\` to register a tunnel.`
    )
  }

  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch (err) {
    throw new Error(`Failed to read config file ${configPath}: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `Invalid JSON in config file ${configPath}. Please fix or delete and re-register.`
    )
  }

  const config = parsed as Record<string, unknown>
  if (
    typeof config['slug'] !== 'string' ||
    typeof config['port'] !== 'number' ||
    typeof config['httpEnabled'] !== 'boolean'
  ) {
    throw new Error(
      `Invalid config in ${configPath}: expected { slug: string, port: number, httpEnabled: boolean }`
    )
  }

  return {
    slug: config['slug'] as string,
    port: config['port'] as number,
    httpEnabled: config['httpEnabled'] as boolean,
  }
}

/**
 * Writes the .tunnel config file (on first registration).
 */
export function writeTunnelConfig(configPath: string, config: TunnelConfig): void {
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

/**
 * Writes TUNNEL_TOKEN to .env file.
 * Creates if not exists, updates the TUNNEL_TOKEN line if present.
 */
export function writeToken(cwd: string, token: string): void {
  const envPath = path.join(cwd, '.env')
  const newLine = `TUNNEL_TOKEN=${token}`

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, newLine + '\n', 'utf8')
    return
  }

  const content = fs.readFileSync(envPath, 'utf8')
  const lines = content.split('\n')
  const tokenLineIdx = lines.findIndex((l) => l.startsWith('TUNNEL_TOKEN='))

  if (tokenLineIdx >= 0) {
    lines[tokenLineIdx] = newLine
    fs.writeFileSync(envPath, lines.join('\n'), 'utf8')
  } else {
    // Append, ensuring file ends with newline
    const appended = content.endsWith('\n') ? content + newLine + '\n' : content + '\n' + newLine + '\n'
    fs.writeFileSync(envPath, appended, 'utf8')
  }
}

/**
 * Validates that the token's slug matches the config slug.
 * Decodes JWT without verification — just parses the payload.
 * Returns true if match, false if mismatch.
 * Throws if token is malformed.
 */
export function validateTokenSlugMatch(token: string, slug: string): boolean {
  let decoded: Record<string, unknown>
  try {
    const payload = jwt.decode(token)
    if (!payload || typeof payload !== 'object') {
      throw new Error('Token payload is not an object')
    }
    decoded = payload as Record<string, unknown>
  } catch (err) {
    throw new Error(`Malformed TUNNEL_TOKEN: ${(err as Error).message}`)
  }

  const tokenSlug = decoded['slug'] as string | undefined
  if (tokenSlug === undefined) {
    throw new Error('TUNNEL_TOKEN payload missing "slug" field')
  }

  return tokenSlug === slug
}

/**
 * Main loader: calls loadDotenv(), reads config file, validates token match.
 */
export function loadConfig(options: {
  configFile?: string
  cwd?: string
}): LoadedConfig {
  const cwd = options.cwd ?? process.cwd()

  // Load dotenv files first so TUNNEL_TOKEN is available from .env
  loadDotenv(cwd)

  const configPath = options.configFile ?? process.env['TUNNEL_CONFIG_FILE'] ?? path.join(cwd, '.tunnel')

  const tunnel = readTunnelConfig(configPath)

  const token = process.env['TUNNEL_TOKEN'] ?? null
  const userToken = process.env['TUNNEL_USER_TOKEN'] ?? null

  // Validate token slug matches config slug if both are present
  if (token && tunnel.slug) {
    const matches = validateTokenSlugMatch(token, tunnel.slug)
    if (!matches) {
      let decoded: Record<string, unknown>
      try {
        decoded = jwt.decode(token) as Record<string, unknown>
      } catch {
        decoded = {}
      }
      const tokenSlug = decoded['slug'] as string ?? 'unknown'
      throw new ConfigMismatchError(
        `TUNNEL_TOKEN was issued for slug '${tokenSlug}' but .tunnel configures slug '${tunnel.slug}'. Run \`snc start --slug ${tokenSlug}\` or delete .tunnel to re-register.`
      )
    }
  }

  return { tunnel, token, userToken, configPath }
}
