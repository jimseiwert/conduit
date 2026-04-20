import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { listRequests, listSlugs, deleteSlug } from '@/lib/relay'

export default async function SlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/login')

  const [slugs, requests] = await Promise.all([
    listSlugs(session.user.id),
    listRequests(slug),
  ])

  const slugRecord = slugs.find(s => s.slug === slug)
  if (!slugRecord) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-400 hover:text-gray-700 text-sm">
              ← Dashboard
            </Link>
            <span className="text-gray-300">/</span>
            <span className="font-mono text-sm font-medium">{slug}</span>
          </div>
          <form
            action={async () => {
              'use server'
              await deleteSlug(slug, session.user.id)
              redirect('/dashboard')
            }}
          >
            <button
              type="submit"
              className="text-xs text-red-500 hover:text-red-700"
            >
              Delete endpoint
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-1">Request history</h2>
          <p className="text-sm text-gray-500">
            Last {requests.length} requests to{' '}
            <code className="font-mono">relay.conduitrelay.com/{slug}</code>
          </p>
        </div>

        {requests.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <p className="text-gray-500 text-sm">No requests yet.</p>
            <p className="text-gray-400 text-xs mt-2">
              Point a webhook sender at{' '}
              <code className="font-mono">https://relay.conduitrelay.com/{slug}</code>
            </p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Method</th>
                  <th className="text-left px-4 py-3">Path</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Duration</th>
                  <th className="text-left px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map(req => (
                  <tr key={req.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-mono font-medium">{req.method}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600 max-w-xs truncate">
                      {req.path}
                    </td>
                    <td className="px-4 py-3">
                      {req.status === null ? (
                        <span className="text-yellow-500">pending</span>
                      ) : (
                        <span className={req.status >= 400 ? 'text-red-500' : 'text-green-600'}>
                          {req.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {req.durationMs !== null ? `${req.durationMs}ms` : '--'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(req.ts).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
