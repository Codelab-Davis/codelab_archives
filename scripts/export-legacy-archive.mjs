#!/usr/bin/env node
// Read-only export for reviewing the legacy archive before a database migration.
// The MDX body is source material, not trusted HTML and not executable content.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import ts from 'typescript'

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const results = await Promise.all(
    entries.map(async (entry) => {
      const name = path.join(directory, entry.name)
      if (entry.isDirectory()) return walk(name)
      return entry.isFile() && name.endsWith('.mdx') ? [name] : []
    })
  )
  return results.flat().sort()
}

// Interpret literals only. Never import or execute the legacy TypeScript file.
function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((property) => {
        if (
          !ts.isPropertyAssignment(property) ||
          !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          throw new Error('Only literal object properties are supported')
        }
        return [property.name.text, literal(property.initializer)]
      })
    )
  }
  throw new Error(`Unsupported expression in sampleFiles: ${ts.SyntaxKind[node.kind]}`)
}

export function parseFiles(source) {
  const file = ts.createSourceFile(
    'projectsData.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'sampleFiles') {
        if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
          throw new Error('sampleFiles must be an array literal')
        }
        return literal(declaration.initializer)
      }
    }
  }
  throw new Error('sampleFiles not found')
}

export async function exportLegacy(root = process.cwd()) {
  const blogRoot = path.join(root, 'data/blog')
  const blogs = await Promise.all(
    (await walk(blogRoot)).map(async (filename) => {
      const { data, content } = matter(await readFile(filename, 'utf8'))
      const slug = path
        .relative(blogRoot, filename)
        .split(path.sep)
        .join('/')
        .replace(/\.mdx$/, '')
      return {
        source: `data/blog/${slug}.mdx`,
        legacyPath: `/blog/${slug.split('/').map(encodeURIComponent).join('/')}`,
        frontmatter: data,
        // MDX may contain JSX, imports, or expressions. This is NOT safe to compile.
        sourceMdx: content,
      }
    })
  )
  const files = parseFiles(await readFile(path.join(root, 'data/projectsData.ts'), 'utf8'))
  return { format: 'codelab-legacy-export-v1', blogs, files }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  exportLegacy()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
