// RSS serialization is shared by both public routes. Only pass public posts here.
import { slug } from 'github-slugger'

const xml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]
  )

export function generateRss(config, posts, tag) {
  const selected = posts.filter(
    (post) => post.draft !== true && (!tag || post.tags?.some((t) => slug(t) === tag))
  )
  const feedPath = tag ? `tags/${encodeURIComponent(tag)}/feed.xml` : 'feed.xml'
  const items = selected
    .map((post) => {
      const url = `${config.siteUrl}/blog/${post.slug.split('/').map(encodeURIComponent).join('/')}`
      return `<item><guid>${xml(url)}</guid><title>${xml(post.title)}</title><link>${xml(url)}</link>${post.summary ? `<description>${xml(post.summary)}</description>` : ''}<pubDate>${xml(new Date(post.date).toUTCString())}</pubDate><author>${xml(`${config.email} (${config.author})`)}</author>${(post.tags || []).map((t) => `<category>${xml(t)}</category>`).join('')}</item>`
    })
    .join('\n')
  const lastBuildDate = selected.length
    ? `<lastBuildDate>${xml(new Date(selected[0].date).toUTCString())}</lastBuildDate>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(config.title)}</title><link>${xml(config.siteUrl)}/blog</link><description>${xml(config.description)}</description><language>${xml(config.language)}</language><managingEditor>${xml(`${config.email} (${config.author})`)}</managingEditor><webMaster>${xml(`${config.email} (${config.author})`)}</webMaster>${lastBuildDate}<atom:link href="${xml(`${config.siteUrl}/${feedPath}`)}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`
}
