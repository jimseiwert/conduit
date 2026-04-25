import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import jwt from 'jsonwebtoken'

const CLI_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60 // 1 year

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const jwtSecret = process.env.CONDUIT_JWT_SECRET
  if (!jwtSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 })
  }

  let body: { callback?: string; userId?: string; email?: string }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { callback, email } = body

  if (!callback) {
    return NextResponse.json({ error: 'Missing callback URL' }, { status: 400 })
  }

  // Verify callback is a localhost or registered VS Code extension URI to prevent open redirect
  let callbackUrl: URL
  try {
    callbackUrl = new URL(callback)
  } catch {
    return NextResponse.json({ error: 'Invalid callback URL' }, { status: 400 })
  }
  const isLocalhost = callbackUrl.hostname === 'localhost' || callbackUrl.hostname === '127.0.0.1'
  const isVscodeExtension = callbackUrl.protocol === 'vscode:' && callbackUrl.hostname === 'jimseiwert.conduit-relay'
  if (!isLocalhost && !isVscodeExtension) {
    return NextResponse.json({ error: 'Callback must be localhost or the Conduit VS Code extension URI' }, { status: 400 })
  }

  const token = jwt.sign(
    {
      userId: session.user.id,
      email: session.user.email,
      type: 'cli',
    },
    jwtSecret,
    { expiresIn: CLI_TOKEN_TTL_SECONDS }
  )

  callbackUrl.searchParams.set('token', token)
  callbackUrl.searchParams.set('userId', session.user.id)
  callbackUrl.searchParams.set('email', email ?? session.user.email)

  return NextResponse.json({ redirectUrl: callbackUrl.toString() })
}
