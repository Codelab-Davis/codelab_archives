export const dynamic = 'force-dynamic'

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
}

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path') || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9._-]{1,160}$/.test(path))
    return new Response(null, { status: 404, headers })

  const filename = path.slice(37)
  if (filename === '.' || filename === '..') return new Response(null, { status: 404, headers })

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !key) return new Response(null, { status: 404, headers })

  try {
    const object = await fetch(`${base}/functions/v1/archives-read-asset`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!object.ok) return new Response(null, { status: object.status === 404 ? 404 : 503, headers })
    const type = object.headers.get('content-type')?.split(';')[0].trim() || ''
    if (!object.body || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(type))
      return new Response(null, { status: 404, headers })
    return new Response(object.body, {
      headers: {
        ...headers,
        'Content-Type': type,
        'Content-Disposition': `${type === 'application/pdf' ? 'attachment' : 'inline'}; filename="${filename}"`,
      },
    })
  } catch {
    // A failed publication check must never fall back to officer access or a stored URL.
    return new Response(null, { status: 503, headers })
  }
}
