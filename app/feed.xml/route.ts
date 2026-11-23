import { publicPosts } from 'lib/archive/public'
import { generateRss } from 'scripts/rss.mjs'
import siteMetadata from '@/data/siteMetadata'

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(generateRss(siteMetadata, await publicPosts()), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
