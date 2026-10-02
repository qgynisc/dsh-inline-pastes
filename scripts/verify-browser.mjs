/**
 * 真实浏览器端到端验证：起一个只读静态服务器 → 无头 Chrome 打开 harness →
 * harness 把结果 POST 回来 → 打印并决定退出码。
 *
 * 为什么不用 jsdom：本插件的关键路径（elementFromPoint / caretRangeFromPoint /
 * ClipboardEvent / DataTransfer / PointerEvent）全是浏览器真行为，假 DOM 测不出东西。
 *
 * 用法：node scripts/verify-browser.mjs [--keep] [--chrome <path>]
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const TIMEOUT_MS = 45_000
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const args = process.argv.slice(2)
const chromeArg = args.indexOf('--chrome')
const CANDIDATES = [
  chromeArg >= 0 ? args[chromeArg + 1] : undefined,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  process.env.CHROME_PATH,
].filter(Boolean)
const CHROME = CANDIDATES.find((candidate) => existsSync(candidate))
if (CHROME === undefined) {
  console.error('跳过：找不到 Chrome/Chromium（用 --chrome <path> 或 $CHROME_PATH 指定）')
  process.exit(2)
}

/* ---- 静态服务器：只服务本仓库，另外收 harness 的结果回执 ---- */
let settle = null
const resultPromise = new Promise((resolveResult) => {
  settle = resolveResult
})

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (request.method === 'POST' && url.pathname === '/__result') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      response.writeHead(204).end()
      try {
        settle(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        settle({ status: 'fail', results: [{ name: '结果回执解析失败', ok: false, detail: String(error) }] })
      }
    })
    return
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(ROOT, relative === '/' ? 'tests/harness/index.html' : relative)
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  response.end(readFileSync(file))
})

await new Promise((done) => server.listen(0, '127.0.0.1', done))
const { port } = server.address()
const url = `http://127.0.0.1:${port}/tests/harness/index.html`

const profileDir = mkdtempSync(join(tmpdir(), 'dsh-inline-pastes-chrome-'))
const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1000,800',
    `--user-data-dir=${profileDir}`,
    url,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const timeout = new Promise((resolveTimeout) => setTimeout(() => resolveTimeout({ status: 'timeout' }), TIMEOUT_MS))
const outcome = await Promise.race([resultPromise, timeout])

child.kill('SIGKILL')
server.close()
await Promise.race([new Promise((done) => child.once('exit', done)), new Promise((done) => setTimeout(done, 3000))])

if (outcome.status === 'timeout') {
  cleanup()
  console.error('✘ 浏览器端验证超时（45s）：harness 没有回执')
  console.error(stderr.split('\n').slice(-12).join('\n'))
  process.exit(1)
}

const results = Array.isArray(outcome.results) ? outcome.results : []
for (const item of results) console.log(`${item.ok ? '✔' : '✘'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
console.log(`\n浏览器端：${outcome.passed ?? results.filter((item) => item.ok).length}/${results.length} 通过`)

const failed = outcome.status !== 'pass'
if (failed) console.error(stderr.split('\n').slice(-8).join('\n'))
cleanup()
process.exit(failed ? 1 : 0)

/** 清理临时 Chrome profile（进程刚退出时可能还占着，重试几次）。 */
function cleanup() {
  if (args.includes('--keep')) return
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
  } catch (error) {
    /* 清理失败不影响验证结论 */
  }
}
