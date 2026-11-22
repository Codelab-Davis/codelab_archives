// Next dev regenerates these files even with isolated test output directories.
// Keep the default test command from leaving a test-only route reference in Git.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const originals = await Promise.all(
  ['next-env.d.ts', 'tsconfig.json', 'app/tag-data.json'].map(async (path) => [
    path,
    await readFile(path),
  ])
)
const tests = (
  await Promise.all(
    ['tests', 'components/admin'].map(async (dir) =>
      (await readdir(dir))
        .filter((name) => name.endsWith('.test.mjs'))
        .map((name) => `${dir}/${name}`)
    )
  )
).flat()
try {
  // Integration tests start Next servers; avoid competing for CI runner resources.
  const options = process.env.CI ? ['--test-concurrency=1'] : []
  const child = spawn(process.execPath, ['--test', ...options, ...tests], { stdio: 'inherit' })
  const [code] = await once(child, 'exit')
  process.exitCode = code ?? 1
} finally {
  await Promise.all(originals.map(([path, content]) => writeFile(path, content)))
}
