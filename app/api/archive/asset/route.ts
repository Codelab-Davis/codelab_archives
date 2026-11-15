import { publicItems } from 'lib/archive/public'
import { remark } from 'remark'

export const dynamic = 'force-dynamic'

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
}

type MarkdownNode = { type: string; url?: string; children?: MarkdownNode[] }
function referencesAsset(node: MarkdownNode, canonical: string): boolean {
  return (
    (['link', 'image', 'definition'].includes(node.type) && node.url === canonical) ||
    Boolean(node.children?.some((child) => referencesAsset(child, canonical)))
  )
}

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path') || ''
  // Match upload-generated immutable UUID/name keys only, not arbitrary storage paths.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9._-]+$/.test(path))
    return new Response(null, { status: 404, headers })

  const canonical = `/api/archive/asset?path=${encodeURIComponent(path)}`
  try {
    const items = await publicItems()
    const referenced = items.some(({ published }) => {
      // Only exact URL-valued fields and Markdown link/image destinations grant access.
      const fields = [published.coverImage, published.url, published.slidesUrl, published.videoUrl]
      if (fields.includes(canonical)) return true
      return referencesAsset(remark().parse(published.body || '') as MarkdownNode, canonical)
    })
    if (!referenced) return new Response(null, { status: 404, headers })

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!base || !key) return new Response(null, { status: 503, headers })
    const object = await fetch(
      `${base}/storage/v1/object/authenticated/archive-assets/${path.split('/').map(encodeURIComponent).join('/')}`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store',
        redirect: 'error',
      }
    )
    if (!object.ok) return new Response(null, { status: 404, headers })
    const type = object.headers.get('content-type')?.split(';')[0].trim() || ''
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(type))
      return new Response(null, { status: 404, headers })
    return new Response(object.body, {
      headers: {
        ...headers,
        'Content-Type': type,
        'Content-Disposition': `${type === 'application/pdf' ? 'attachment' : 'inline'}; filename="${path.split('/')[1]}"`,
      },
    })
  } catch {
    // A failed publication check must never fall back to officer access or a stored URL.
    return new Response(null, { status: 503, headers })
  }
}
