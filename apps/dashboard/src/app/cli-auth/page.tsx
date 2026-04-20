import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import CliAuthForm from './CliAuthForm'

interface Props {
  searchParams: Promise<{ callback?: string }>
}

export default async function CliAuthPage({ searchParams }: Props) {
  const session = await auth.api.getSession({ headers: await headers() })
  const { callback } = await searchParams

  if (!session) {
    const loginUrl = `/login?callbackUrl=${encodeURIComponent(`/cli-auth${callback ? `?callback=${encodeURIComponent(callback)}` : ''}`)}`
    redirect(loginUrl)
  }

  if (!callback) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold mb-2">Missing callback URL</h1>
          <p className="text-gray-500 text-sm">Run <code className="bg-gray-100 px-1 rounded">conduit login</code> from your terminal to start the auth flow.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Authorize CLI</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Logged in as <span className="font-medium text-gray-700">{session.user.email}</span>
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="text-sm text-gray-600 space-y-2">
            <p>The Conduit CLI is requesting access to your account.</p>
            <p>This will allow <code className="bg-gray-100 px-1 rounded">conduit start</code> to connect to the relay as you.</p>
          </div>
          <CliAuthForm
            callback={callback}
            userId={session.user.id}
            email={session.user.email}
          />
        </div>
      </div>
    </div>
  )
}
