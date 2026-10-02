/**
 * 单测公共设施：在 Node 的 vm 里以「浏览器 bundle 的真实形态」加载 lib/client.js。
 *
 * bundle 是 `window.__ModuleLoader__.load({ id, factory })` 形态，所以这里提供一个
 * 假的 window.__ModuleLoader__，再把 factory 拿到的 module.exports 交出去——
 * 测的就是**构建产物本身**，不是源码的另一份拷贝。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 加载构建产物。
 * @param options.document - 注入的假 document（缺省不给，插件 apply 会直接返回）。
 * @returns {id, mod, sandbox}
 */
export function loadBundle(options = {}) {
  const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let loaded
  const sandbox = {
    console,
    URL,
    File,
    Blob,
    setTimeout,
    clearTimeout,
    document: options.document,
    window: {
      __ModuleLoader__: {
        load(mod) {
          loaded = mod
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'lib/client.js' })
  if (loaded === undefined) throw new Error('bundle 没有调用 window.__ModuleLoader__.load')
  const mod = loaded.factory(() => {
    throw new Error('本插件不应解析任何平台模块')
  })
  return { id: loaded.id, mod, sandbox }
}
