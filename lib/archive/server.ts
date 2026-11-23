import 'server-only'
import { authConfig, getSession, type ArchiveSession, type ArchiveUser } from './auth'

type Result<T> = {
  data: T | null
  error: { message: string; code?: string; status?: number } | null
}
type QueryOptions = { count?: 'exact'; head?: boolean }

class Query<T = unknown> implements PromiseLike<Result<T>> {
  private params = new URLSearchParams()
  private method = 'GET'
  private headers: Record<string, string> = {}
  private singleMode = false
  constructor(
    private request: (path: string, init?: RequestInit) => Promise<Result<unknown>>,
    private table: string
  ) {}
  select(columns = '*', options?: QueryOptions): this {
    this.params.set('select', columns)
    if (options?.count) this.headers.Prefer = 'count=exact'
    if (options?.head) this.method = 'HEAD'
    return this
  }
  eq(column: string, value: string | number | boolean): this {
    this.params.append(column, `eq.${value}`)
    return this
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.params.append('order', `${column}.${options?.ascending === false ? 'desc' : 'asc'}`)
    return this
  }
  limit(value: number): this {
    this.params.set('limit', String(value))
    return this
  }
  range(from: number, to: number): this {
    this.headers.Range = `${from}-${to}`
    return this
  }
  single(): this {
    this.headers.Accept = 'application/vnd.pgrst.object+json'
    this.singleMode = true
    return this
  }
  maybeSingle(): this {
    this.singleMode = true
    this.params.set('limit', '1')
    return this
  }
  async then<TResult1 = Result<T>, TResult2 = never>(
    onfulfilled?: ((value: Result<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const result = await this.request(`/rest/v1/${encodeURIComponent(this.table)}?${this.params}`, {
      method: this.method,
      headers: this.headers,
    })
    if (this.singleMode && Array.isArray(result.data)) result.data = result.data[0] ?? null
    return Promise.resolve(result as Result<T>).then(onfulfilled, onrejected)
  }
}

export async function getClient() {
  const { url, key } = authConfig()
  const session = await getSession({ refresh: true })
  const headers = { apikey: key, Authorization: `Bearer ${session?.access_token ?? key}` }
  async function request(path: string, init: RequestInit = {}): Promise<Result<any>> {
    const response = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...headers, ...init.headers },
      cache: 'no-store',
    })
    const text = await response.text()
    let data: any = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!response.ok)
      return {
        data: null,
        error: {
          message: data?.message ?? data?.error ?? response.statusText,
          code: data?.code,
          status: response.status,
        },
      }
    return { data, error: null }
  }
  const objectPath = (bucket: string, path: string) =>
    `${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`
  return {
    from<T = unknown>(table: string) {
      return new Query<T>(request, table)
    },
    rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
      return request(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      })
    },
    storage: {
      from(bucket: string) {
        return {
          upload(
            path: string,
            file: Blob | ArrayBuffer,
            options?: { contentType?: string; upsert?: boolean }
          ) {
            return request(`/storage/v1/object/${objectPath(bucket, path)}`, {
              method: 'POST',
              headers: {
                'Content-Type':
                  options?.contentType ??
                  ((file instanceof Blob ? file.type : '') || 'application/octet-stream'),
                'x-upsert': String(options?.upsert ?? false),
              },
              body: file,
            })
          },
          createSignedUrl(path: string, expiresIn: number) {
            return request(`/storage/v1/object/sign/${objectPath(bucket, path)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ expiresIn }),
            })
          },
          remove(paths: string[]) {
            return request(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prefixes: paths }),
            })
          },
        }
      },
    },
  }
}

export async function requireOfficer(verifiedSession?: ArchiveSession): Promise<ArchiveUser> {
  const session = verifiedSession ?? (await getSession({ refresh: true }))
  if (!session) throw new Error('Unauthorized')
  const { url, key } = authConfig()
  const response = await fetch(`${url}/rest/v1/rpc/archives_is_officer`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
  })
  if (!response.ok || (await response.json()) !== true) throw new Error('Forbidden')
  return session.user
}
