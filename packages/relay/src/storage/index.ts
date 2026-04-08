import type { RelayConfig } from '../config.js'
import type { StorageAdapter } from './interface.js'
import { MemoryStorageAdapter } from './memory.js'
import { SqliteStorageAdapter } from './sqlite.js'
import { PostgresStorageAdapter } from './postgres.js'

export type { StorageAdapter, RequestRecord } from './interface.js'

export async function createStorageAdapter(config: RelayConfig): Promise<StorageAdapter> {
  switch (config.storageAdapter) {
    case 'memory':
      return new MemoryStorageAdapter(config.ringBufferSize)

    case 'sqlite':
      if (!config.sqlitePath) {
        throw new Error('sqlitePath is required for sqlite storage adapter')
      }
      return new SqliteStorageAdapter({
        path: config.sqlitePath,
        ringBufferSize: config.ringBufferSize,
      })

    case 'postgres':
      if (!config.databaseUrl) {
        throw new Error('databaseUrl is required for postgres storage adapter')
      }
      return new PostgresStorageAdapter({
        connectionString: config.databaseUrl,
        ringBufferSize: config.ringBufferSize,
      })

    default: {
      const exhaustive: never = config.storageAdapter
      throw new Error(`Unknown storage adapter: ${exhaustive}`)
    }
  }
}

export { MemoryStorageAdapter } from './memory.js'
export { SqliteStorageAdapter } from './sqlite.js'
export { PostgresStorageAdapter } from './postgres.js'
