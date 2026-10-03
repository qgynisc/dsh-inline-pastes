/**
 * 构建产物形态：必须能被 __ModuleLoader__ 装载、id 必须等于包名、
 * apply 在没有 document 的环境里必须安静地什么都不做。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle } from '../helpers/bundle.mjs'

test('bundle 注册 id 等于包名', () => {
  const { id, mod } = loadBundle()
  assert.equal(id, '@qgynisc/dsh-inline-pastes')
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual([...mod.inject], ['conversation', 'sessions'])
  assert.equal(typeof mod.__test, 'object')
})

test('没有 document 时 apply 直接返回（不会在宿主环境里炸）', () => {
  const { mod } = loadBundle()
  let effects = 0
  const ctx = {
    get: () => undefined,
    effect: () => {
      effects += 1
    },
  }
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.equal(effects, 0)
})

test('样式已随构建注入 bundle', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.match(code, /dsh-ip-card/)
  assert.match(code, /data-dsh-inline-pastes/)
  assert.match(code, /window\.__ModuleLoader__\.load\(\{ id: "@qgynisc\/dsh-inline-pastes"/)
  assert.equal(/\brequire\s*\(/.test(code.replace(/factory: \(require\) =>/, '')), true, '设置页要从模块加载器拿 React')
  /* React 是 DSH 模块加载器提供的平台外部模块：只允许 require('react')，别的一律不许。 */
  const calls = [...code.replace(/factory: \(require\) =>/, '').matchAll(/(^|[^.\w])(require\s*\([^)]*\))/gm)].map((match) => match[2].trim())
  assert.deepEqual([...new Set(calls)], ["require('react')"], "bundle 里只允许 require('react')")
})

test('设置页随构建内联进 bundle（锚点替换成功）', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.match(code, /'settings\.section'/, '设置页槽名要进产物')
  assert.match(code, /输入框图文混排设置/, '面板标题要进产物')
  assert.match(code, /Mixed layout/, '英文词库要进产物')
})
