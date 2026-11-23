import test from 'node:test'
import assert from 'node:assert/strict'
import { publishedAssetPaths } from '../app/api/admin/[action]/assets.ts'

const path = '12345678-1234-1234-1234-123456789abc/image.png'
const url = `/api/archive/asset?path=${encodeURIComponent(path)}`
test('collects exact fields and Markdown destinations, not plain text or code', () => {
  assert.deepEqual(publishedAssetPaths({ coverImage: url, body: `![image](${url})\n\n[ref]: ${url}\n\n${url}\n\n\`${url}\`` }), [path])
  assert.deepEqual(publishedAssetPaths({ body: `${url}\n\n\`${url}\`` }), [])
})
test('rejects noncanonical, malformed and embedded URLs', () => {
  for (const value of [url + '&extra=1', url.replace('%2F', '/'), 'https://evil.example' + url, '/api/archive/asset?path=%zz']) {
    assert.deepEqual(publishedAssetPaths({ url: value, body: `[x](${value})` }), [])
  }
})
