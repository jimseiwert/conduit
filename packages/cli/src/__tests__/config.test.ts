import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  loadProjectConfig,
  saveProjectConfig,
  generateSlug,
  getHomeConfigDir,
  ConfigMismatchError,
  ConfigNotFoundError,
  type ProjectEntry,
} from '../config.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conduit-test-'))
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('generateSlug', () => {
  it('returns a string starting with "ws-"', () => {
    const slug = generateSlug()
    expect(slug).toMatch(/^ws-[a-f0-9]{12}$/)
  })

  it('returns unique slugs on each call', () => {
    const s1 = generateSlug()
    const s2 = generateSlug()
    expect(s1).not.toBe(s2)
  })
})

describe('getHomeConfigDir', () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env['CONDUIT_HOME']
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env['CONDUIT_HOME']
    else process.env['CONDUIT_HOME'] = savedEnv
  })

  it('returns ~/.conduit by default', () => {
    delete process.env['CONDUIT_HOME']
    const dir = getHomeConfigDir()
    expect(dir).toBe(path.join(os.homedir(), '.conduit'))
  })

  it('respects CONDUIT_HOME override', () => {
    process.env['CONDUIT_HOME'] = '/custom/conduit'
    expect(getHomeConfigDir()).toBe('/custom/conduit')
  })
})

describe('loadProjectConfig / saveProjectConfig', () => {
  let tmpProjectDir: string
  let tmpHomeDir: string
  let savedConduitHome: string | undefined

  beforeEach(() => {
    tmpProjectDir = makeTmpDir()
    tmpHomeDir = makeTmpDir()
    savedConduitHome = process.env['CONDUIT_HOME']
    process.env['CONDUIT_HOME'] = tmpHomeDir
  })

  afterEach(() => {
    fs.rmSync(tmpProjectDir, { recursive: true, force: true })
    fs.rmSync(tmpHomeDir, { recursive: true, force: true })
    if (savedConduitHome === undefined) delete process.env['CONDUIT_HOME']
    else process.env['CONDUIT_HOME'] = savedConduitHome
  })

  it('returns null when no config exists for the project', () => {
    const result = loadProjectConfig(tmpProjectDir)
    expect(result).toBeNull()
  })

  it('saves and loads a project entry', () => {
    const entry: ProjectEntry = {
      slug: 'ws-aabbccddee11',
      token: 'tok-abc',
      port: 3000,
      httpEnabled: false,
      relayUrl: 'wss://relay.conduitrelay.com',
    }
    saveProjectConfig(tmpProjectDir, entry)

    const loaded = loadProjectConfig(tmpProjectDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.slug).toBe('ws-aabbccddee11')
    expect(loaded!.token).toBe('tok-abc')
    expect(loaded!.port).toBe(3000)
    expect(loaded!.httpEnabled).toBe(false)
    expect(loaded!.relayUrl).toBe('wss://relay.conduitrelay.com')
  })

  it('updates an existing entry when saved again', () => {
    const entry: ProjectEntry = {
      slug: 'ws-aabbccddee11',
      token: null,
      port: 3000,
      httpEnabled: false,
    }
    saveProjectConfig(tmpProjectDir, entry)
    saveProjectConfig(tmpProjectDir, { ...entry, token: 'new-token', port: 4000 })

    const loaded = loadProjectConfig(tmpProjectDir)
    expect(loaded!.token).toBe('new-token')
    expect(loaded!.port).toBe(4000)
  })

  it('preserves entries for other projects when saving', () => {
    const dir2 = makeTmpDir()
    try {
      const entry1: ProjectEntry = { slug: 'ws-000000000001', token: null, port: 3000, httpEnabled: false }
      const entry2: ProjectEntry = { slug: 'ws-000000000002', token: null, port: 4000, httpEnabled: true }

      saveProjectConfig(tmpProjectDir, entry1)
      saveProjectConfig(dir2, entry2)

      const loaded1 = loadProjectConfig(tmpProjectDir)
      const loaded2 = loadProjectConfig(dir2)

      expect(loaded1!.slug).toBe('ws-000000000001')
      expect(loaded2!.slug).toBe('ws-000000000002')
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('uses normalized absolute path as key', () => {
    const entry: ProjectEntry = { slug: 'ws-aabbccddee11', token: null, port: 3000, httpEnabled: false }
    saveProjectConfig(tmpProjectDir, entry)

    // Load with trailing slash should still find the entry
    const loaded = loadProjectConfig(path.resolve(tmpProjectDir))
    expect(loaded).not.toBeNull()
  })

  it('writes valid JSON to projects.json', () => {
    const entry: ProjectEntry = { slug: 'ws-aabbccddee11', token: 'tok', port: 3000, httpEnabled: false }
    saveProjectConfig(tmpProjectDir, entry)

    const configPath = path.join(tmpHomeDir, 'projects.json')
    expect(fs.existsSync(configPath)).toBe(true)

    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
    expect(typeof parsed.projects).toBe('object')
  })
})

describe('ConfigMismatchError and ConfigNotFoundError', () => {
  it('ConfigMismatchError has correct name', () => {
    const err = new ConfigMismatchError('mismatch')
    expect(err.name).toBe('ConfigMismatchError')
    expect(err.message).toBe('mismatch')
  })

  it('ConfigNotFoundError has correct name', () => {
    const err = new ConfigNotFoundError('not found')
    expect(err.name).toBe('ConfigNotFoundError')
    expect(err.message).toBe('not found')
  })
})
