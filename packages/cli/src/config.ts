import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomBytes } from 'node:crypto'

export interface ProjectEntry {
  slug: string
  token: string | null
  port: number
  httpEnabled: boolean
  relayUrl?: string
}

export interface GlobalConfig {
  relayUrl?: string
  dashboardUrl?: string
}

interface HomeConfig {
  version: number
  global?: GlobalConfig
  projects: Record<string, ProjectEntry>
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
 * Returns the path to the ~/.conduit directory.
 * Respects the CONDUIT_HOME environment variable override.
 */
export function getHomeConfigDir(): string {
  return process.env['CONDUIT_HOME'] ?? path.join(os.homedir(), '.conduit')
}

/**
 * Returns the path to the ~/.conduit/projects.json file.
 */
function getHomeConfigPath(): string {
  return path.join(getHomeConfigDir(), 'projects.json')
}

/**
 * Reads the home config file and returns all projects, or an empty config if
 * the file does not exist or cannot be parsed.
 */
function readHomeConfig(): HomeConfig {
  const configPath = getHomeConfigPath()
  if (!fs.existsSync(configPath)) {
    return { version: 1, projects: {} }
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as HomeConfig
    if (!parsed.projects || typeof parsed.projects !== 'object') {
      return { version: 1, projects: {} }
    }
    return parsed
  } catch {
    return { version: 1, projects: {} }
  }
}

/**
 * Loads the project config entry for the given project root directory.
 * Returns null if no entry exists for this project.
 */
export function loadProjectConfig(cwd: string): ProjectEntry | null {
  const normalized = path.resolve(cwd)
  const config = readHomeConfig()
  return config.projects[normalized] ?? null
}

/**
 * Saves (or updates) the project config entry for the given project root directory.
 * Writes atomically to ~/.conduit/projects.json.
 */
export function saveProjectConfig(cwd: string, entry: ProjectEntry): void {
  const normalized = path.resolve(cwd)
  const configDir = getHomeConfigDir()
  const configPath = getHomeConfigPath()

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  const config = readHomeConfig()
  config.projects[normalized] = entry

  // Write to a temp file then rename for atomic update
  const tmpPath = configPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, configPath)
}

/**
 * Loads the global config (relay URL, dashboard URL) from ~/.conduit/projects.json.
 */
export function loadGlobalConfig(): GlobalConfig {
  return readHomeConfig().global ?? {}
}

/**
 * Saves global config fields (relay URL, dashboard URL) into ~/.conduit/projects.json.
 */
export function saveGlobalConfig(global: GlobalConfig): void {
  const configDir = getHomeConfigDir()
  const configPath = getHomeConfigPath()

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  const config = readHomeConfig()
  config.global = { ...config.global, ...global }

  const tmpPath = configPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  fs.renameSync(tmpPath, configPath)
}

/**
 * Returns the effective relay WebSocket URL, checking in order:
 * CONDUIT_RELAY_URL env var → global config → default
 */
export function getRelayUrl(): string {
  return (
    process.env['CONDUIT_RELAY_URL'] ??
    loadGlobalConfig().relayUrl ??
    'wss://relay.conduitrelay.com'
  )
}

/**
 * Returns the effective dashboard URL for auth, checking in order:
 * CONDUIT_DASHBOARD_URL env var → global config → default
 */
export function getDashboardUrl(): string {
  return (
    process.env['CONDUIT_DASHBOARD_URL'] ??
    loadGlobalConfig().dashboardUrl ??
    'https://app.conduitrelay.com'
  )
}

/**
 * Generates a new unique relay slug in the form "ws-" followed by 12 hex chars.
 * Example: "ws-a3f9c2b1d4e6"
 */
export function generateSlug(): string {
  return 'ws-' + randomBytes(6).toString('hex')
}
