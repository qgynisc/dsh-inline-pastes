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
  assert.equal(/\brequire\s*\(/.test(code.replace(/factory: \(require\) =>/, '')), false, 'bundle 里不应有模块解析调用')
})
