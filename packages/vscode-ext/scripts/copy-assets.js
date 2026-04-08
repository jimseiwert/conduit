import { cpSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(__dirname, '../dist/media'), { recursive: true })
cpSync(join(__dirname, '../media'), join(__dirname, '../dist/media'), { recursive: true })
