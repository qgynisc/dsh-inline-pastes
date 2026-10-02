/**
 * 安装自检：从 profile 目录出发，把 dsh-client-modules 的解析链**原样走一遍**，
 * 在重启应用之前就能发现「装了但加载器找不到 / 注册 ID 对不上」这类问题。
 *
 * 校验项：
 *   1. profile 的 node_modules 能按包名解析到 package.json；
 *   2. dsh.client 声明存在且 platform === 'web'；
 *   3. exports["./client"] 指向的文件真的存在；
 *   4. bundle 里注册的 id === 包名（不等就是 "loaded without registering"）；
 *   5. bundle 能以 window.__ModuleLoader__ 形态求值并导出 apply / inject；
 *   6. cordis.patch.yml 的 insert 行 name === 包名（行 id 故意不同，便于识别）；
 *   7. profile 的 dsh.profile.bundles 里包含本包。
 *
 * 用法：node scripts/verify-install.mjs [--profile desktop]
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const OWN_MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const PACKAGE_NAME = OWN_MANIFEST.name

const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const PROFILE = profileIndex >= 0 ? args[profileIndex + 1] : 'desktop'
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE)
const PROFILE_MANIFEST = join(PROFILE_DIR, 'package.json')

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail: detail === undefined ? '' : String(detail) })

if (!existsSync(PROFILE_MANIFEST)) {
  console.error(`✘ 找不到 profile 清单：${PROFILE_MANIFEST}`)
  process.exit(1)
}

/* 1) 按包名解析 */
const require = createRequire(PROFILE_MANIFEST)
let packageJsonPath
try {
  packageJsonPath = require.resolve(`${PACKAGE_NAME}/package.json`)
} catch (error) {
  packageJsonPath = undefined
}
check(`profile 能解析 ${PACKAGE_NAME}/package.json`, packageJsonPath !== undefined, packageJsonPath ?? '解析失败')

const installed = packageJsonPath === undefined ? undefined : JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const packageRoot = packageJsonPath === undefined ? undefined : dirname(packageJsonPath)

/* 2) dsh.client 声明 */
check('package.json 带 dsh.client 声明', installed?.dsh?.client !== undefined)
check("dsh.client.platform === 'web'", installed?.dsh?.client?.platform === 'web', installed?.dsh?.client?.platform)

/* 2b) dsh.bundle 声明 + patch 文件真实存在（缺了会被加载器整包 skip） */
const bundlePatch = installed?.dsh?.bundle?.patch
check('package.json 带 dsh.bundle.patch 声明', typeof bundlePatch === 'string', bundlePatch ?? '缺少 dsh.bundle → 加载器会 "declares no dsh.bundle" 跳过整包')
const bundlePatchPath = packageRoot !== undefined && typeof bundlePatch === 'string' ? join(packageRoot, bundlePatch) : undefined
check('dsh.bundle.patch 指向真实文件', bundlePatchPath !== undefined && existsSync(bundlePatchPath), bundlePatchPath ?? '')

/* 2c) 版本兼容闸门：只有 @deepseek-ai/dsh* 的 peer 会被卡（cordis 不算） */
const dshPeers = Object.keys(installed?.peerDependencies ?? {}).filter((name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
check('peerDependencies 里没有会被兼容闸门拦下的 @deepseek-ai/dsh* 项', dshPeers.length === 0, dshPeers.length === 0 ? '无' : JSON.stringify(dshPeers))

/* 3) exports["./client"] 指向的文件存在 */
const clientExport = installed?.exports?.['./client']
const clientRelative = typeof clientExport === 'string' ? clientExport : clientExport?.default
const clientPath = packageRoot !== undefined && typeof clientRelative === 'string' ? join(packageRoot, clientRelative) : undefined
check('exports["./client"] 指向真实文件', clientPath !== undefined && existsSync(clientPath), clientPath ?? '缺少 exports["./client"]')

/* 4)(5) bundle 形态 */
if (clientPath !== undefined && existsSync(clientPath)) {
  const code = readFileSync(clientPath, 'utf8')
  let loaded
  const sandbox = { console, URL, File, Blob, setTimeout, clearTimeout, window: { __ModuleLoader__: { load: (mod) => (loaded = mod) } } }
  try {
    vm.createContext(sandbox)
    vm.runInContext(code, sandbox, { filename: clientPath })
  } catch (error) {
    check('bundle 可求值', false, error.message)
  }
  check('bundle 调用了 window.__ModuleLoader__.load', loaded !== undefined)
  check('bundle 注册 id === 包名', loaded?.id === PACKAGE_NAME, `${loaded?.id} vs ${PACKAGE_NAME}`)
  let mod
  try {
    mod = loaded?.factory(() => {
      throw new Error('不应解析平台模块')
    })
  } catch (error) {
    check('bundle factory 可执行', false, error.message)
  }
  check('bundle 导出 apply()', typeof mod?.apply === 'function')
  check('bundle 导出 inject 服务列表', Array.isArray(mod?.inject) && mod.inject.length > 0, JSON.stringify(mod?.inject))
}

/* 6) cordis.patch.yml 的行 */
const patchPath = join(ROOT, 'cordis.patch.yml')
const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
const patchName = /-\s*insert:\s*\n\s*-\s*id:\s*(\S+)\s*\n\s*name:\s*'?([^'\n]+)'?/.exec(patch)
check('cordis.patch.yml 有 insert 行且 name === 包名', patchName?.[2]?.trim() === PACKAGE_NAME, patchName === null ? '没匹配到 insert 行' : `id=${patchName[1]} name=${patchName[2].trim()}`)
check('cordis.patch.yml 行 id 与包名不同（避免插件卡片重复显示）', patchName !== null && patchName[1] !== PACKAGE_NAME, patchName?.[1])

/* 7) profile bundles 列表 */
const profileManifest = JSON.parse(readFileSync(PROFILE_MANIFEST, 'utf8'))
const bundles = profileManifest?.dsh?.profile?.bundles ?? []
check(`profile bundles 含 ${PACKAGE_NAME}`, bundles.includes(PACKAGE_NAME))

let failed = 0
for (const item of checks) {
  if (!item.ok) failed += 1
  console.log(`${item.ok ? '✔' : '✘'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
}
console.log(`\n安装自检：${checks.length - failed}/${checks.length} 通过（profile=${PROFILE}）`)
process.exit(failed === 0 ? 0 : 1)
