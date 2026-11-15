import { publicPosts } from 'lib/archive/public'

export const dynamic = 'force-dynamic'

export async function GET() {
  const posts = await publicPosts()
  // KBar only consumes these fields; never expose MDX bodies or draft metadata.
  return Response.json(
    posts
      .filter((post) => post.draft !== true)
      .map(({ path, title, summary, date }) => ({ path, title, summary, date })),
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
