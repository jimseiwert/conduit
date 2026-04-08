import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import jwt from 'jsonwebtoken'
import {
  loadDotenv,
  readConduitConfig,
  writeConduitConfig,
  writeToken,
  validateTokenSlugMatch,
  loadConfig,
  ConfigMismatchError,
  type ConduitConfig,
} from '../config.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-test-'))
}

function makeToken(slug: string, secret = 'test-secret', expiresIn = '90d'): string {
  return jwt.sign({ slug }, secret, { expiresIn })
}

function writeEnvFile(dir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8')
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('validateTokenSlugMatch', () => {
  it('returns true when slugs match', () => {
    const token = makeToken('myapp')
    expect(validateTokenSlugMatch(token, 'myapp')).toBe(true)
  })

  it('returns false when slugs do not match', () => {
    const token = makeToken('other-slug')
    expect(validateTokenSlugMatch(token, 'myapp')).toBe(false)
  })

  it('throws on malformed token', () => {
    expect(() => validateTokenSlugMatch('not.a.valid.jwt', 'myapp')).toThrow()
  })

  it('throws when token payload is missing slug', () => {
    const tokenWithoutSlug = jwt.sign({ foo: 'bar' }, 'secret')
    expect(() => validateTokenSlugMatch(tokenWithoutSlug, 'myapp')).toThrow(/slug/)
  })
})

describe('readConduitConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads a valid .conduit config file', () => {
    const configPath = path.join(tmpDir, '.conduit')
    const config: ConduitConfig = { slug: 'myapp', port: 3000, httpEnabled: false }
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8')

    const loaded = readConduitConfig(configPath)
    expect(loaded.slug).toBe('myapp')
    expect(loaded.port).toBe(3000)
    expect(loaded.httpEnabled).toBe(false)
  })

  it('throws when config file does not exist', () => {
    expect(() => readConduitConfig(path.join(tmpDir, '.conduit'))).toThrow(/not found/)
  })

  it('throws on invalid JSON', () => {
    const configPath = path.join(tmpDir, '.conduit')
    fs.writeFileSync(configPath, '{ invalid json }', 'utf8')
    expect(() => readConduitConfig(configPath)).toThrow(/Invalid JSON/)
  })

  it('throws when required fields are missing', () => {
    const configPath = path.join(tmpDir, '.conduit')
    fs.writeFileSync(configPath, JSON.stringify({ slug: 'myapp' }), 'utf8')
    expect(() => readConduitConfig(configPath)).toThrow(/Invalid config/)
  })
})

describe('writeConduitConfig', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('creates a .conduit file with correct content', () => {
    const configPath = path.join(tmpDir, '.conduit')
    writeConduitConfig(configPath, { slug: 'myapp', port: 4000, httpEnabled: true })

    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.slug).toBe('myapp')
    expect(parsed.port).toBe(4000)
    expect(parsed.httpEnabled).toBe(true)
  })
})

describe('writeToken', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('creates .env if it does not exist', () => {
    writeToken(tmpDir, 'my-token')
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')
    expect(content).toContain('CONDUIT_TOKEN=my-token')
  })

  it('updates existing CONDUIT_TOKEN line', () => {
    writeEnvFile(tmpDir, '.env', 'CONDUIT_TOKEN=old-token\nOTHER=value\n')
    writeToken(tmpDir, 'new-token')
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')
    expect(content).toContain('CONDUIT_TOKEN=new-token')
    expect(content).not.toContain('old-token')
    expect(content).toContain('OTHER=value')
  })

  it('appends CONDUIT_TOKEN when other vars exist but no token line', () => {
    writeEnvFile(tmpDir, '.env', 'OTHER=value\n')
    writeToken(tmpDir, 'appended-token')
    const content = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8')
    expect(content).toContain('CONDUIT_TOKEN=appended-token')
    expect(content).toContain('OTHER=value')
  })
})

describe('loadDotenv', () => {
  let tmpDir: string
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    tmpDir = makeTmpDir()
    savedEnv = {
      CONDUIT_TOKEN: process.env['CONDUIT_TOKEN'],
      TEST_VAR: process.env['TEST_VAR'],
      LOCAL_VAR: process.env['LOCAL_VAR'],
    }
    delete process.env['CONDUIT_TOKEN']
    delete process.env['TEST_VAR']
    delete process.env['LOCAL_VAR']
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('loads .env file', () => {
    writeEnvFile(tmpDir, '.env', 'TEST_VAR=from-env\n')
    loadDotenv(tmpDir)
    expect(process.env['TEST_VAR']).toBe('from-env')
  })

  it('.env.local overrides .env', () => {
    writeEnvFile(tmpDir, '.env', 'TEST_VAR=from-env\nLOCAL_VAR=base\n')
    writeEnvFile(tmpDir, '.env.local', 'TEST_VAR=from-local\n')
    loadDotenv(tmpDir)
    expect(process.env['TEST_VAR']).toBe('from-local')
    expect(process.env['LOCAL_VAR']).toBe('base')
  })

  it('does not throw if no .env files exist', () => {
    expect(() => loadDotenv(tmpDir)).not.toThrow()
  })
})

describe('loadConfig', () => {
  let tmpDir: string
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    tmpDir = makeTmpDir()
    savedEnv = {
      CONDUIT_TOKEN: process.env['CONDUIT_TOKEN'],
      CONDUIT_USER_TOKEN: process.env['CONDUIT_USER_TOKEN'],
      CONDUIT_CONFIG_FILE: process.env['CONDUIT_CONFIG_FILE'],
    }
    delete process.env['CONDUIT_TOKEN']
    delete process.env['CONDUIT_USER_TOKEN']
    delete process.env['CONDUIT_CONFIG_FILE']
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('loads config and token from .conduit + .env', () => {
    const configPath = path.join(tmpDir, '.conduit')
    writeConduitConfig(configPath, { slug: 'myapp', port: 3000, httpEnabled: false })

    const token = makeToken('myapp')
    writeEnvFile(tmpDir, '.env', `CONDUIT_TOKEN=${token}\n`)

    const cfg = loadConfig({ configFile: configPath, cwd: tmpDir })
    expect(cfg.conduit.slug).toBe('myapp')
    expect(cfg.token).toBe(token)
  })

  it('CONDUIT_TOKEN from .env takes precedence — token is loaded from env file', () => {
    const configPath = path.join(tmpDir, '.conduit')
    writeConduitConfig(configPath, { slug: 'myapp', port: 3000, httpEnabled: false })

    // Set a different token in process.env (simulating it not being in .env)
    // and a token in .env that matches
    const token = makeToken('myapp')
    writeEnvFile(tmpDir, '.env', `CONDUIT_TOKEN=${token}\n`)

    const cfg = loadConfig({ configFile: configPath, cwd: tmpDir })
    expect(cfg.token).toBe(token)
    expect(cfg.conduit.slug).toBe('myapp')
  })

  it('.env.local token overrides .env token', () => {
    const configPath = path.join(tmpDir, '.conduit')
    writeConduitConfig(configPath, { slug: 'myapp', port: 3000, httpEnabled: false })

    const baseToken = makeToken('myapp')
    const localToken = makeToken('myapp')
    writeEnvFile(tmpDir, '.env', `CONDUIT_TOKEN=${baseToken}\n`)
    writeEnvFile(tmpDir, '.env.local', `CONDUIT_TOKEN=${localToken}\n`)

    const cfg = loadConfig({ configFile: configPath, cwd: tmpDir })
    // .env.local overrides .env
    expect(cfg.token).toBe(localToken)
  })

  it('missing CONDUIT_TOKEN falls back gracefully to null', () => {
    const configPath = path.join(tmpDir, '.conduit')
    writeConduitConfig(configPath, { slug: 'myapp', port: 3000, httpEnabled: false })

    const cfg = loadConfig({ configFile: configPath, cwd: tmpDir })
    expect(cfg.token).toBeNull()
  })

  it('throws ConfigMismatchError when token slug does not match config slug', () => {
    const configPath = path.join(tmpDir, '.conduit')
    writeConduitConfig(configPath, { slug: 'myapp', port: 3000, httpEnabled: false })

    // Token issued for a different slug
    const wrongToken = makeToken('other-slug')
    writeEnvFile(tmpDir, '.env', `CONDUIT_TOKEN=${wrongToken}\n`)

    expect(() => loadConfig({ configFile: configPath, cwd: tmpDir })).toThrow(ConfigMismatchError)
  })

  it('ConfigMismatchError message contains both slugs', () => {
    const configPath = path.join(tmpDir, '.conduit')
    writeConduitConfig(configPath, { slug: 'myapp', port: 3000, httpEnabled: false })
    const wrongToken = makeToken('other-slug')
    writeEnvFile(tmpDir, '.env', `CONDUIT_TOKEN=${wrongToken}\n`)

    let error: ConfigMismatchError | null = null
    try {
      loadConfig({ configFile: configPath, cwd: tmpDir })
    } catch (err) {
      error = err as ConfigMismatchError
    }

    expect(error).not.toBeNull()
    expect(error!.message).toContain('other-slug')
    expect(error!.message).toContain('myapp')
  })
})
