'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { SlugRecord } from '@/lib/relay'

export default function SlugList({ slugs }: { slugs: SlugRecord[] }) {
  const [copied, setCopied] = useState<string | null>(null)

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  if (slugs.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
        <p className="text-gray-500 text-sm">No endpoints yet. Create one to get started.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {slugs.map(slug => {
        const webhookUrl = `https://relay.conduitrelay.com/${slug.slug}`
        const cliCmd = `conduit start --slug ${slug.slug} --port 3000`
        return (
          <div key={slug.slug} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-sm font-medium">{slug.slug}</span>
                  <span className="text-xs text-gray-400">
                    expires {new Date(slug.expiresAt * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-16 shrink-0">Webhook</span>
                    <code className="text-xs font-mono text-gray-700 truncate">{webhookUrl}</code>
                    <button
                      onClick={() => copy(webhookUrl, `wh-${slug.slug}`)}
                      className="text-xs text-gray-400 hover:text-gray-700 shrink-0"
                    >
                      {copied === `wh-${slug.slug}` ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-16 shrink-0">CLI</span>
                    <code className="text-xs font-mono text-gray-700 truncate">{cliCmd}</code>
                    <button
                      onClick={() => copy(cliCmd, `cli-${slug.slug}`)}
                      className="text-xs text-gray-400 hover:text-gray-700 shrink-0"
                    >
                      {copied === `cli-${slug.slug}` ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
              <Link
                href={`/dashboard/${slug.slug}`}
                className="text-xs text-gray-500 hover:text-gray-900 shrink-0"
              >
                Requests →
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}
