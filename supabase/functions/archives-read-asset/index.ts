import { remark } from 'npm:remark@15.0.1'

// Public delivery is gated by the current published snapshot, not an officer session.
// Storage credentials are injected by Supabase and stay inside this function.
const PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9._-]{1,160}$/
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
const noStore = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
}
const empty = (status: number) => new Response(null, { status, headers: noStore })

type MarkdownNode = { type: string; url?: string; children?: MarkdownNode[] }
function referencesAsset(node: MarkdownNode, canonical: string): boolean {
  return (
    (['link', 'image', 'definition'].includes(node.type) && node.url === canonical) ||
    Boolean(node.children?.some((child) => referencesAsset(child, canonical)))
  )
}

async function parsePath(request: Request): Promise<string | null> {
  // Bound the body even when Content-Length is missing or inaccurate.
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.length
    if (length > 2048) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.path !== 'string' ||
      !PATH_PATTERN.test(body.path) ||
      ['.', '..'].includes(body.path.split('/')[1])
    )
      return null
    return body.path
  } catch {
    return null
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return empty(404)
  try {
    const path = await parsePath(request)
    if (!path) return empty(404)
    const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')
    const secretKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default
    const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!base || (!secretKey && !legacyKey)) return empty(503)
    const auth = new Headers({ apikey: secretKey || legacyKey! })
    if (!secretKey) auth.set('Authorization', `Bearer ${legacyKey}`)

    const rpcHeaders = new Headers(auth)
    rpcHeaders.set('Content-Type', 'application/json')
    const publication = await fetch(`${base}/rest/v1/rpc/archives_asset_publications`, {
      method: 'POST',
      headers: rpcHeaders,
      body: JSON.stringify({ asset_path: path }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    })
    if (!publication.ok) return empty(503)
    const snapshots = await publication.json()
    if (!Array.isArray(snapshots)) return empty(503)
    const canonical = `/api/archive/asset?path=${encodeURIComponent(path)}`
    const referenced = snapshots.some((content) => {
      if (!content || typeof content !== 'object') return false
      if (
        [content.coverImage, content.url, content.slidesUrl, content.videoUrl].includes(canonical)
      )
        return true
      return (
        typeof content.body === 'string' &&
        referencesAsset(remark().parse(content.body) as MarkdownNode, canonical)
      )
    })
    if (!referenced) return empty(404)

    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const object = await fetch(
      `${base}/storage/v1/object/authenticated/archive-assets/${encodedPath}`,
      {
        headers: auth,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      }
    )
    if (object.status === 404) return empty(404)
    if (!object.ok || !object.body) return empty(503)
    const type = object.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || ''
    if (!TYPES.has(type)) return empty(404)
    return new Response(object.body, {
      headers: {
        ...noStore,
        'Content-Type': type,
        'Content-Disposition': `attachment; filename="${path.slice(37)}"`,
      },
    })
  } catch {
    return empty(503)
  }
})
