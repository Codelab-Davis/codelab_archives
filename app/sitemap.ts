import { MetadataRoute } from 'next'
import { publicPosts } from 'lib/archive/public'
import siteMetadata from '@/data/siteMetadata'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = siteMetadata.siteUrl

  const blogRoutes = (await publicPosts()).map((post) => ({
    url: `${siteUrl}/${post.path.split('/').map(encodeURIComponent).join('/')}`,
    lastModified: post.lastmod || post.date,
  }))

  const routes = ['', 'blog', 'projects', 'about'].map((route) => ({
    url: `${siteUrl}/${route}`,
    lastModified: new Date().toISOString().split('T')[0],
  }))

  return [...routes, ...blogRoutes]
}
