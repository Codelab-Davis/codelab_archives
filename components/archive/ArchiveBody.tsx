import { createElement, Fragment, ReactNode } from 'react'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'

// Only render known Markdown nodes. Raw HTML and unknown nodes are never interpreted.
export function safeArchiveUrl(value?: string): string | undefined {
  if (!value) return undefined
  const url = value.trim()
  return /^(https?:|mailto:)/i.test(url) || /^\/(?![\\/])/.test(url) || /^#/.test(url)
    ? url
    : undefined
}

type Node = {
  type: string
  value?: string
  url?: string
  alt?: string
  depth?: number
  ordered?: boolean
  start?: number
  identifier?: string
  children?: Node[]
}
function resolveReferences(root: Node): Node {
  const definitions = new Map<string, string>()
  function collect(node: Node) {
    if (node.type === 'definition' && node.identifier && node.url)
      definitions.set(node.identifier.toLowerCase(), node.url)
    node.children?.forEach(collect)
  }
  collect(root)
  function resolve(node: Node): Node {
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      return {
        ...node,
        type: node.type === 'linkReference' ? 'link' : 'image',
        url: definitions.get((node.identifier || '').toLowerCase()),
        children: node.children?.map(resolve),
      }
    }
    return { ...node, children: node.children?.map(resolve) }
  }
  return resolve(root)
}
function render(node: Node, key: number): ReactNode {
  const children = node.children?.map(render)
  switch (node.type) {
    case 'root':
      return <Fragment key={key}>{children}</Fragment>
    case 'text':
      return node.value
    case 'paragraph':
      return <p key={key}>{children}</p>
    case 'heading':
      return createElement(`h${Math.min(6, Math.max(1, node.depth || 1))}`, { key }, children)
    case 'strong':
      return <strong key={key}>{children}</strong>
    case 'emphasis':
      return <em key={key}>{children}</em>
    case 'delete':
      return <del key={key}>{children}</del>
    case 'inlineCode':
      return <code key={key}>{node.value}</code>
    case 'code':
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      )
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>
    case 'list':
      return node.ordered ? (
        <ol key={key} start={node.start}>
          {children}
        </ol>
      ) : (
        <ul key={key}>{children}</ul>
      )
    case 'listItem':
      return <li key={key}>{children}</li>
    case 'break':
      return <br key={key} />
    case 'thematicBreak':
      return <hr key={key} />
    case 'link': {
      const href = safeArchiveUrl(node.url)
      return href ? (
        <a key={key} href={href}>
          {children}
        </a>
      ) : (
        <Fragment key={key}>{children}</Fragment>
      )
    }
    case 'image': {
      const src = safeArchiveUrl(node.url)
      return src ? <img key={key} src={src} alt={node.alt || ''} /> : null
    }
    case 'table':
      return (
        <table key={key}>
          <tbody>{children}</tbody>
        </table>
      )
    case 'tableRow':
      return <tr key={key}>{children}</tr>
    case 'tableCell':
      return <td key={key}>{children}</td>
    default:
      return null
  }
}
export default function ArchiveBody({ body }: { body: string }) {
  return (
    <>
      {render(
        resolveReferences(
          remark()
            .use(remarkGfm)
            .parse(body || '') as Node
        ),
        0
      )}
    </>
  )
}
