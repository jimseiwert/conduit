import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'
import { NextRequest } from 'next/server'

const handler = toNextJsHandler(auth)

export async function GET(req: NextRequest) {
  try {
    return await handler.GET(req)
  } catch (e) {
    console.error('[auth] GET error:', e)
    throw e
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handler.POST(req)
  } catch (e) {
    console.error('[auth] POST error:', e)
    throw e
  }
}
