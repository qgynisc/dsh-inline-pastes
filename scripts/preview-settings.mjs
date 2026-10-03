/**
 * dsh-inline-pastes — 设置页离线预览出图
 *
 * 起一个只读静态服务器 → 无头 Chrome 打开 tests/harness/settings-preview.html
 * （用 React 替身 + 迷你 DOM 渲染器把面板画出来）→ 截图裁掉多余留白 → docs/settings.png。
 *
 * 用途：
 *   1. README 里的设置页示意图（可复现，不依赖真机截图）；
 *   2. 不开 DSH 也能看一眼面板长什么样 —— 核对外观时省得反复重启应用。
 *
 * 用法：
 *   node scripts/preview-settings.mjs                # → docs/settings.png
 *   node scripts/preview-settings.mjs --out /tmp/a.png --chrome "/path/to/Chrome"
 *
 * 注意：这是**示意图**，用的是替身 React 与假渲染器，不代表真机像素。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

const args = process.argv.slice(2)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const OUT = resolve(argValue('--out') ?? join(ROOT, 'docs', 'settings.png'))
/* 原始截图放临时目录：Chrome 的 --screenshot 路径里带空格会写不出来（本仓库路径就带空格） */
const RAW = join(tmpdir(), 'dsh-inline-pastes-settings-raw.png')
const WIDTH = 640
const HEIGHT = 1600

const CANDIDATES = [
  argValue('--chrome'),
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
if (statSync(join(ROOT, 'lib', 'client.js'), { throwIfNoEntry: false }) === undefined) {
  console.error('✘ 先跑 npm run build：lib/client.js 还没有')
  process.exit(1)
}

/* ---- 静态服务器：只服务本仓库 ---- */
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(ROOT, relative === '/' ? 'tests/harness/settings-preview.html' : relative)
  let body
  try {
    body = readFileSync(file)
  } catch (error) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  response.end(body)
})

await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
const port = server.address().port
const url = `http://127.0.0.1:${port}/tests/harness/settings-preview.html`

mkdirSync(dirname(OUT), { recursive: true })
/* 必须用异步 spawn：spawnSync 会**阻塞 Node 事件循环**，上面那个静态服务器就答不了
 * 请求了 —— Chrome 拿不到页面，截图静默失败（退出码还是 0）。 */
const runChrome = (chromeArgs) =>
  new Promise((resolveRun) => {
    const child = spawn(CHROME, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const killer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.on('close', (code) => {
      clearTimeout(killer)
      resolveRun({ code, stderr })
    })
  })

const shot = await runChrome(
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--virtual-time-budget=4000',
    `--screenshot=${RAW}`,
    url,
  ],
)
server.close()

if (!existsSync(RAW)) {
  console.error(`✘ 截图失败（Chrome 退出码 ${shot.code}）`)
  const noise = `${shot.stderr ?? ''}`.split('\n').filter((line) => line.includes('written') || line.includes('ERROR') || line.includes('Error')).slice(-5)
  if (noise.length > 0) console.error(noise.join('\n'))
  process.exit(1)
}

/* ---- 裁掉四周留白（背景是 #f4f5f7）---- */
const python = process.env.DSH_PYTHON ?? '/Users/qgynisc/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3'
const cropper = `
import sys
from PIL import Image, ImageChops
raw, out = sys.argv[1], sys.argv[2]
image = Image.open(raw).convert("RGB")
bg = Image.new("RGB", image.size, (244, 245, 247))
box = ImageChops.difference(image, bg).getbbox()
if box is None:
    image.save(out); print("整页都是背景色，原样输出"); raise SystemExit
pad = 32
left, top, right, bottom = box
image.crop((max(0, left - pad), max(0, top - pad), min(image.width, right + pad), min(image.height, bottom + pad))).save(out)
print(f"裁剪后 {min(image.width, right + pad) - max(0, left - pad)}x{min(image.height, bottom + pad) - max(0, top - pad)}")
`
const cropped = spawnSync(python, ['-c', cropper, RAW, OUT], { encoding: 'utf8' })
rmSync(RAW, { force: true })
if (cropped.status !== 0) {
  console.error('✘ 裁剪失败：', cropped.stderr || cropped.stdout)
  process.exit(1)
}
console.log(`设置页预览 → ${OUT}（${cropped.stdout.trim()}）`)
