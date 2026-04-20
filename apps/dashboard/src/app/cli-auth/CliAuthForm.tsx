'use client'

import { useState } from 'react'

interface Props {
  callback: string
  userId: string
  email: string
}

export default function CliAuthForm({ callback, userId, email }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function authorize() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/cli-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback, userId, email }),
      })
      const data = await res.json() as { redirectUrl?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to authorize')
      window.location.href = data.redirectUrl!
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        onClick={authorize}
        disabled={loading}
        className="w-full py-2 px-4 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Authorizing...' : 'Authorize CLI access'}
      </button>
      <p className="text-xs text-gray-400 text-center">
        This grants CLI access. You can revoke it by logging out.
      </p>
    </div>
  )
}
