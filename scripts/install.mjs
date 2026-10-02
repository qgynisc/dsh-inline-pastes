/**
 * 把本插件装进某个 DSH profile（默认 desktop）。
 *
 * 做的事（每一步都可回滚）：
 *   1. 备份 profile 的 package.json / pnpm-lock.yaml（带时间戳）；
 *   2. dependencies 里加 `"dsh-inline-pastes": "link:<本仓库>"`；
 *   3. dsh.profile.bundles 里追加 `"dsh-inline-pastes"`（bundle 的 cordis.patch.yml
 *      由 DSH 自动应用，profile 的 cordis.patch.yml 不用改）；
 *   4. 在 profile 目录跑 pnpm install（先 --offline，失败再联网）；
 *   5. 自检 node_modules 里的链接与包清单。
 *
 * 用法：
 *   node scripts/install.mjs --profile desktop
 *   node scripts/install.mjs --profile desktop --uninstall
 *   DSH_HOME=~/.dsh node scripts/install.mjs --profile web
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_NAME = MANIFEST.name

const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const PROFILE = profileIndex >= 0 ? args[profileIndex + 1] : 'desktop'
const UNINSTALL = args.includes('--uninstall')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE)
const PROFILE_MANIFEST = join(PROFILE_DIR, 'package.json')
const PROFILE_LOCK = join(PROFILE_DIR, 'pnpm-lock.yaml')

/** 时间戳后缀（备份用）。 */
function stamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 备份文件（存在才备份，返回备份路径）。 */
function backup(file) {
  if (!existsSync(file)) return undefined
  const target = `${file}.bak.${stamp()}-${UNINSTALL ? 'pre-inline-pastes-uninstall' : 'pre-inline-pastes'}`
  copyFileSync(file, target)
  return target
}

if (!existsSync(PROFILE_MANIFEST)) {
  console.error(`找不到 profile 清单：${PROFILE_MANIFEST}`)
  const profilesDir = join(DSH_HOME, 'profiles')
  const names = existsSync(profilesDir) ? readdirSync(profilesDir).filter((name) => !name.startsWith('.')) : []
  if (names.length > 0) console.error(`可用的 profile：${names.join(', ')}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(PROFILE_MANIFEST, 'utf8'))
manifest.dependencies = manifest.dependencies ?? {}
manifest.dsh = manifest.dsh ?? {}
manifest.dsh.profile = manifest.dsh.profile ?? {}
manifest.dsh.profile.bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []

const alreadyListed = manifest.dsh.profile.bundles.includes(PACKAGE_NAME)
const alreadyLinked = typeof manifest.dependencies[PACKAGE_NAME] === 'string'

if (UNINSTALL) {
  delete manifest.dependencies[PACKAGE_NAME]
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== PACKAGE_NAME)
} else {
  manifest.dependencies[PACKAGE_NAME] = `link:${ROOT}`
  if (!alreadyListed) manifest.dsh.profile.bundles.push(PACKAGE_NAME)
}

const backups = [backup(PROFILE_MANIFEST), backup(PROFILE_LOCK)].filter(Boolean)
writeFileSync(PROFILE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`${UNINSTALL ? '卸载' : '安装'} ${PACKAGE_NAME} → profile "${PROFILE}"`)
console.log(`  profile 目录：${PROFILE_DIR}`)
console.log(`  依赖：${UNINSTALL ? '已移除' : `link:${ROOT}`}${alreadyLinked && !UNINSTALL ? '（原本就在）' : ''}`)
console.log(`  bundles：${alreadyListed && !UNINSTALL ? '原本已在列表' : UNINSTALL ? '已移除' : '已追加'}`)
for (const file of backups) console.log(`  备份：${file}`)

/* ---- pnpm install ---- */
const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
if (pnpm.status !== 0) {
  console.error('\n✘ 找不到 pnpm；请手动在 profile 目录执行：pnpm install')
  process.exit(1)
}

const install = (flags) => spawnSync('pnpm', ['install', ...flags], { cwd: PROFILE_DIR, stdio: 'inherit' })
console.log('\n运行 pnpm install（先离线，失败再联网）…')
let outcome = install(['--offline', '--ignore-scripts'])
if (outcome.status !== 0) {
  console.log('离线安装未成功，改为联网安装…')
  outcome = install(['--ignore-scripts'])
}
if (outcome.status !== 0) {
  console.error('\n✘ pnpm install 失败；profile 清单已改好，可在 profile 目录手动重试：pnpm install')
  process.exit(outcome.status ?? 1)
}

/* ---- 自检 ---- */
const link = join(PROFILE_DIR, 'node_modules', PACKAGE_NAME)
const problems = []
if (!UNINSTALL) {
  if (!existsSync(link)) problems.push(`node_modules/${PACKAGE_NAME} 不存在`)
  else {
    const stat = lstatSync(link)
    if (!stat.isSymbolicLink() && !stat.isDirectory()) problems.push(`node_modules/${PACKAGE_NAME} 形态异常`)
    else if (stat.isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) !== ROOT) {
      problems.push(`node_modules/${PACKAGE_NAME} 指向了别处：${readlinkSync(link)}`)
    }
  }
  if (!existsSync(join(ROOT, 'lib', 'client.js'))) problems.push('lib/client.js 还没构建（先跑 npm run build）')
  const host = JSON.parse(readFileSync(PROFILE_MANIFEST, 'utf8'))
  if (!host.dsh.profile.bundles.includes(PACKAGE_NAME)) problems.push('bundles 列表里没有本插件')
}

if (problems.length > 0) {
  console.error(`\n✘ 安装自检未通过：\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}

console.log(`\n✔ ${UNINSTALL ? '卸载' : '安装'}完成`)
if (!UNINSTALL) {
  console.log('  下一步：重启 DeepSeek Harness（客户端插件要刷新页面才能加载新 bundle）。')
  console.log(`  回滚：node scripts/install.mjs --profile ${PROFILE} --uninstall`)
}
