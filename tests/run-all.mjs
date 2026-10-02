/**
 * 一次跑完两层验证：
 *   1. 单测（node --test tests/unit）—— 纯逻辑 + 假 DOM 下的决策路径；
 *   2. 真实浏览器 harness —— 真 Chrome 里的 ClipboardEvent / elementFromPoint /
 *      caretRangeFromPoint 全真行为。
 *
 * 浏览器层找不到 Chrome 时判为「跳过」而不是「失败」（退出码 2 视为跳过）。
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' })

console.log('== 1/2 构建 + 单测 ==')
const build = run(['scripts/build.mjs'])
if (build.status !== 0) process.exit(build.status ?? 1)
const unit = run(['--test', 'tests/unit/'])
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
