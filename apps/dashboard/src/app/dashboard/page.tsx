import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { listSlugs, createSlug } from '@/lib/relay'
import SlugList from './slug-list'

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const slugs = await listSlugs(session.user.id)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="font-bold text-lg">Conduit</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{session.user.email}</span>
            <form action="/api/auth/sign-out" method="POST">
              <button className="text-sm text-gray-500 hover:text-gray-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">Relay endpoints</h2>
            <p className="text-sm text-gray-500 mt-1">Each endpoint tunnels webhooks to your local server.</p>
          </div>
          <form
            action={async () => {
              'use server'
              await createSlug(session.user.id)
            }}
          >
            <button
              type="submit"
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
            >
              New endpoint
            </button>
          </form>
        </div>

        <SlugList slugs={slugs} />
      </main>
    </div>
  )
}
