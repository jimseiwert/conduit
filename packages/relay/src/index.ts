import { loadConfig } from './config.js'
import { createStorageAdapter } from './storage/index.js'
import { createServer } from './server.js'

const config = loadConfig()
const storage = await createStorageAdapter(config)
const app = await createServer(config, storage)

await app.listen({ port: config.port, host: '0.0.0.0' })
console.log(`Relay listening on port ${config.port}`)

process.on('SIGTERM', async () => {
  app.log.info('SIGTERM received — shutting down gracefully')
  await app.close()
  await storage.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  app.log.info('SIGINT received — shutting down gracefully')
  await app.close()
  await storage.close()
  process.exit(0)
})
