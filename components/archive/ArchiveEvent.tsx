import SectionContainer from '@/components/SectionContainer'
import Link from '@/components/Link'
import ShareButton from '@/components/ShareButton'
import ResourcesSidebar from '@/components/ResourcesSidebar'
import ArchiveBody, { safeArchiveUrl } from './ArchiveBody'

export interface ArchiveContent {
  title?: string
  slug?: string
  date?: string
  quarter?: string
  tags?: string[]
  summary?: string
  coverImage?: string
  videoUrl?: string
  slidesUrl?: string
  body?: string
  description?: string
  type?: string
  url?: string
}
export default function ArchiveEvent({ content }: { content: ArchiveContent }) {
  const cover = safeArchiveUrl(content.coverImage)
  const video = safeArchiveUrl(content.videoUrl)
  const slides = safeArchiveUrl(content.slidesUrl)
  let embed: string | undefined
  try {
    const u = new URL(video || '')
    if (
      ['youtube.com', 'www.youtube.com'].includes(u.hostname) &&
      u.pathname === '/watch' &&
      /^[\w-]+$/.test(u.searchParams.get('v') || '')
    )
      embed = `https://www.youtube.com/embed/${u.searchParams.get('v')}`
    if (
      ['youtube.com', 'www.youtube.com'].includes(u.hostname) &&
      /^\/embed\/[\w-]+$/.test(u.pathname)
    )
      embed = `https://www.youtube.com${u.pathname}`
  } catch {
    // Non-YouTube or malformed URLs are shown as links, never embedded.
  }
  const workshop = { videoUrl: video || '', slidesUrl: slides }
  return (
    <SectionContainer>
      <article className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-8">
          <Link href="/blog" className="text-gray-600 hover:text-gray-900">
            ← Back to workshops
          </Link>
        </div>
        {cover && (
          <div className="mb-8">
            <div className="relative overflow-hidden rounded-xl">
              <img
                src={cover}
                alt={content.title || ''}
                className="aspect-video w-full object-cover"
              />
            </div>
          </div>
        )}
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold">{content.title}</h1>
          <div className="flex items-center justify-center gap-2 text-gray-600">
            <time>
              {content.date && !isNaN(Date.parse(content.date))
                ? new Date(content.date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                : ''}
            </time>
            <span>•</span>
            <span>Workshop</span>
            <span>•</span>
            <ShareButton className="flex items-center gap-1 hover:text-gray-900" />
          </div>
          {content.quarter && <p className="mt-3 text-sm text-[#7B6E63]">{content.quarter}</p>}
          {content.summary && <p className="mx-auto mt-4 max-w-2xl">{content.summary}</p>}
          {content.tags && content.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {content.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[#7B6E63]/10 px-3 py-1 text-sm text-[#7B6E63]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mb-16 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {embed && (
            <div className="lg:col-span-8">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl">
                <iframe
                  src={embed}
                  title="Workshop Video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute left-0 top-0 h-full w-full"
                />
              </div>
            </div>
          )}
          <div className={embed ? 'lg:col-span-4' : 'lg:col-span-12'}>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <ResourcesSidebar workshop={workshop} content={{}} />
            </div>
          </div>
        </div>
        <div className="prose max-w-none">
          <ArchiveBody body={content.body || ''} />
        </div>
      </article>
    </SectionContainer>
  )
}
