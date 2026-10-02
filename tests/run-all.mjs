/**
 * 一次跑完两层验证：
 *   1. 单测（node --test tests/unit）—— 纯逻辑 + 假 DOM 下的决策路径；
 *   2. 真实浏览器 harness —— 真 Chrome 里的 ClipboardEvent / elementFromPoint /
 *      caretRangeFromPoint 全真行为。
 *
 * 浏览器层找不到 Chrome 时判为「跳过」而不是「失败」（退出码 2 视为跳过）。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })

/* 自己枚举测试文件，不依赖 shell 展开 glob：
 * `node --test <目录>` 在 Node 20/24 上行为不一致（24 会把目录当模块去 require），显式列文件最稳。 */
const UNIT_DIR = join(ROOT, 'tests', 'unit')
const unitFiles = readdirSync(UNIT_DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(UNIT_DIR, name))
if (unitFiles.length === 0) {
  console.error('✘ tests/unit 下一个测试文件都没有')
  process.exit(1)
}

console.log('== 1/2 构建 + 单测 ==')
const build = run(['scripts/build.mjs'])
if (build.status !== 0) process.exit(build.status ?? 1)
const unit = run(['--test', ...unitFiles])
if (unit.status !== 0) {
  console.error('\n✘ 单测未通过')
  process.exit(unit.status ?? 1)
}

console.log('\n== 2/2 真实浏览器端到端 ==')
const browser = run(['scripts/verify-browser.mjs'])
if (browser.status === 2) {
  console.log('⚠ 已跳过浏览器层（本机没有 Chrome/Chromium）')
} else if (browser.status !== 0) {
  console.error('\n✘ 浏览器端验证未通过')
  process.exit(browser.status ?? 1)
}

console.log('\n✔ 全部验证通过')
