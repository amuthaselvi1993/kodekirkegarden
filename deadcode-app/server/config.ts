import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// dev: deadcode-app/server, built: deadcode-app/dist/server
const appRoot = path.basename(path.dirname(here)) === 'dist' ? path.resolve(here, '../..') : path.resolve(here, '..')

// The server only ever listens on the loopback interface. This is deliberately not configurable.
export const HOST = '127.0.0.1' as const

const port = Number(process.env.PORT ?? 4310)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535')
export const PORT = port

// Vite dev server (only used with `npm run dev`); allowed as an origin for the API.
export const WEB_DEV_PORT = 5173

export const SKILL_PATH = process.env.SKILL_PATH ?? path.resolve(appRoot, '..', '.claude', 'skills', 'dead-code-cleanup', 'SKILL.md')
export const WEB_DIST = path.join(appRoot, 'dist', 'web')
export const WORK_ROOT = path.join(os.tmpdir(), 'deadcode-app')

// Optional model override; otherwise the Agent SDK default is used.
export const MODEL = process.env.DEADCODE_MODEL || undefined

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_TURNS = 80
