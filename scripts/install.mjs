/**
 * 把本插件装进某个 DSH profile（默认 desktop）。
 *
 * 做的事（每一步都可回滚）：
 *   1. 备份 profile 的 package.json / pnpm-lock.yaml（带时间戳）；
 *   2. dependencies 里加 `"@qgynisc/dsh-inline-pastes": "link:<本仓库>"`；
 *   3. dsh.profile.bundles 里追加 `"@qgynisc/dsh-inline-pastes"`（bundle 的 cordis.patch.yml
 *      由 DSH 自动应用，profile 的 cordis.patch.yml 不用改）；
 *   3b. 清掉加 scope 之前用过的旧键（见 LEGACY_NAMES）：留着会出现
 *       「插件卡片只显示 dsh-inline-pastes、没有 @qgynisc、也没有描述/图标」的旧卡片
 *       ——DSH 按 profile 里的键名（不是包自己的 name）查插件元数据；
 *   4. 在 profile 目录跑 pnpm install（先 --offline，失败再联网）；
 *   5. 自检 node_modules 里的链接与包清单。
 *
 * 用法：
 *   node scripts/install.mjs --profile desktop
 *   node scripts/install.mjs --profile desktop --uninstall
 *   DSH_HOME=~/.dsh node scripts/install.mjs --profile web
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_NAME = MANIFEST.name

/**
 * 本包在加 npm scope 之前用过的安装键（老 profile 里可能还留着）。
 * 例如 "@qgynisc/dsh-inline-pastes" → ["dsh-inline-pastes"]。
 * DSH 是按 profile 里的键名去解析插件元数据的：键名与包名不一致时，
 * 插件卡片拿不到 title/description/icon，只能回退显示那个（不带 scope 的）键名。
 */
const LEGACY_NAMES = PACKAGE_NAME.startsWith('@') ? [PACKAGE_NAME.slice(PACKAGE_NAME.indexOf('/') + 1)] : []

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

/** 清掉旧的无 scope 键（依赖 + bundle 列表），返回真正动过的键名。 */
const migrateLegacy = () => {
  const touched = []
  for (const legacy of LEGACY_NAMES) {
    let hit = false
    if (Object.hasOwn(manifest.dependencies, legacy)) {
      delete manifest.dependencies[legacy]
      hit = true
    }
    if (manifest.dsh.profile.bundles.includes(legacy)) {
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== legacy)
      hit = true
    }
    if (hit) touched.push(legacy)
  }
  return touched
}

if (UNINSTALL) {
  delete manifest.dependencies[PACKAGE_NAME]
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== PACKAGE_NAME)
  for (const legacy of migrateLegacy()) console.log(`  旧键 ${legacy}：已移除`)
} else {
  manifest.dependencies[PACKAGE_NAME] = `link:${ROOT}`
  if (!alreadyListed) manifest.dsh.profile.bundles.push(PACKAGE_NAME)
  for (const legacy of migrateLegacy()) console.log(`  旧键 ${legacy} 已迁移到 ${PACKAGE_NAME}`)
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

/* ---- 清掉 pnpm 没有回收的旧键软链（pnpm 会留下已不在依赖里的 link 软链） ---- */
for (const legacy of LEGACY_NAMES) {
  const stale = join(PROFILE_DIR, 'node_modules', legacy)
  let stat
  try {
    stat = lstatSync(stale)
  } catch {
    continue
  }
  if (!stat.isSymbolicLink()) continue // 只在确认是软链时删：绝不碰真实目录
  rmSync(stale, { force: true })
  console.log(`  旧软链 node_modules/${legacy}：已清理`)
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
  for (const legacy of LEGACY_NAMES) {
    if (host.dsh.profile.bundles.includes(legacy) || Object.hasOwn(host.dependencies ?? {}, legacy)) {
      problems.push(`profile 里还留着旧键 ${legacy}（会让插件卡片显示成不带 scope 的名字）`)
    }
    if (existsSync(join(PROFILE_DIR, 'node_modules', legacy))) {
      problems.push(`node_modules/${legacy} 旧软链还在（本包现在以 ${PACKAGE_NAME} 解析）`)
    }
  }
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
