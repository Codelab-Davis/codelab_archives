import test from 'node:test'
import assert from 'node:assert/strict'
import { generateRss } from '../scripts/rss.mjs'

const config = {
  siteUrl: 'https://example.test',
  title: 'A & B',
  description: '<archive>',
  language: 'en',
  email: 'a@example.test',
  author: 'A',
}
const posts = [
  {
    slug: 'public & one',
    title: '<Public>',
    summary: 'safe & sound',
    date: '2024-01-01',
    tags: ['Design & Art'],
  },
  {
    slug: 'secret',
    title: 'Secret draft',
    date: '2024-01-01',
    tags: ['Design & Art'],
    draft: true,
  },
  { slug: 'other', title: 'Other', date: '2023-01-01', tags: ['Else'] },
]

test('RSS escapes content and excludes drafts, including tag feeds', () => {
  const feed = generateRss(config, posts, 'design--art')
  assert.match(feed, /&lt;Public&gt;/)
  assert.match(feed, /safe &amp; sound/)
  assert.match(feed, /public%20%26%20one/)
  assert.match(feed, /Design &amp; Art/)
  assert.doesNotMatch(feed, /Secret draft|Other/)
})

test('empty feeds are valid and do not require a first post', () => {
  const feed = generateRss(config, [])
  assert.match(feed, /<channel>/)
  assert.doesNotMatch(feed, /lastBuildDate|<item>/)
})
