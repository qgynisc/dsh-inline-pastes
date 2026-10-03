/**
 * 设置系统（client.js 第 0 节）与设置页（panel.js）的回归。
 *
 * 测的是**构建产物**：loadBundle 加载 lib/client.js，__test 里拿这些纯函数。
 * 设置页组件用 tests/helpers/react-shim.js 渲染成一棵对象树来断言文案与控件 ——
 * 真 React 下的行为由真机（设置 → 混合排版）负责验证。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle } from '../helpers/bundle.mjs'
import { createReact, render, textOf, findByClass, findByTag } from '../helpers/react-shim.js'

const { mod } = loadBundle()
const T = mod.__test

/** 每个用例都从出厂设置开始，避免共享的活设置对象串味。 */
const fresh = () => {
  T.resetSettings()
  return T.CONFIG
}

const fakeStorage = () => {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  }
}

test('出厂默认：pic 前缀 + 胶囊短名 + 角标中档 + 语言跟随 DSH', () => {
  const s = fresh()
  assert.equal(s.prefixes.image, 'pic')
  assert.equal(s.chipDisplay, 'short')
  assert.equal(s.badgeSize, 'md')
  assert.equal(s.lang, 'auto')
  assert.equal(s.hoverPreview, true)
  assert.equal(s.enabled, true)
  assert.equal(s.interceptPaste, true)
  assert.equal(s.auditBeforeSend, true)
  /* 老键已经搬进 badgeSize，不该再留着 */
  assert.equal('badgeThumbnails' in s, false)
})

test('mergeSettings：只收已知键，非法值一律落回默认', () => {
  const base = T.defaults()
  const merged = T.mergeSettings(base, {
    badgeSize: 'gigantic',
    chipDisplay: 'rainbow',
    lang: 'fr',
    counterScope: 'forever',
    startIndex: -3,
    hoverDelayMs: -1,
    enabled: 'yes',
    unknownKey: 1,
    prefixes: { image: 'bad prefix!', audio: 'ok_1', video: 7 },
  })
  assert.equal(merged.badgeSize, 'md')
  assert.equal(merged.chipDisplay, 'short')
  assert.equal(merged.lang, 'auto')
  assert.equal(merged.counterScope, 'message')
  assert.equal(merged.startIndex, 1)
  assert.equal(merged.hoverDelayMs, 140)
  assert.equal(merged.enabled, true)
  assert.equal('unknownKey' in merged, false)
  assert.equal(merged.prefixes.image, 'pic')
  assert.equal(merged.prefixes.audio, 'ok_1')
  assert.equal(merged.prefixes.video, 'video')
  /* 合法值要真的生效 */
  const ok = T.mergeSettings(base, { badgeSize: 'lg', lang: 'en', chipDisplay: 'full', prefixes: { image: 'img' } })
  assert.equal(ok.badgeSize, 'lg')
  assert.equal(ok.lang, 'en')
  assert.equal(ok.chipDisplay, 'full')
  assert.equal(ok.prefixes.image, 'img')
})

test('readSettings：脏数据 / 缺数据都退回默认，好数据才生效', () => {
  assert.equal(T.readSettings(undefined).badgeSize, 'md')
  assert.equal(T.readSettings(fakeStorage()).prefixes.image, 'pic')
  const broken = fakeStorage()
  broken.setItem(T.SETTINGS_STORAGE_KEY, '{ 这不是 JSON')
  assert.equal(T.readSettings(broken).badgeSize, 'md')
  const good = fakeStorage()
  good.setItem(T.SETTINGS_STORAGE_KEY, JSON.stringify({ badgeSize: 'sm', prefixes: { image: 'shot' } }))
  const read = T.readSettings(good)
  assert.equal(read.badgeSize, 'sm')
  assert.equal(read.prefixes.image, 'shot')
  /* 没写的键仍然是默认值 */
  assert.equal(read.chipDisplay, 'short')
})

test('updateSettings 立刻改活设置对象；resetSettings 回到出厂', () => {
  const s = fresh()
  let notified = 0
  const off = T.subscribeSettings(() => {
    notified += 1
  })
  T.updateSettings({ badgeSize: 'lg' })
  assert.equal(s.badgeSize, 'lg', '活对象要立刻变（各组件握着同一个引用）')
  assert.equal(notified, 1)
  T.updateSettings({ prefixes: { image: 'snap' } })
  assert.equal(s.prefixes.image, 'snap')
  T.resetSettings()
  assert.equal(s.badgeSize, 'md')
  assert.equal(s.prefixes.image, 'pic')
  assert.equal(notified, 3, '恢复默认也是一次设置变更')
  off()
  const before = notified
  T.updateSettings({ badgeSize: 'sm' })
  assert.equal(notified, before, '退订后不再通知')
  fresh()
})

test('displayNameFor：短名只在显示层去扩展名', () => {
  assert.equal(T.displayNameFor('pic-1.png', { chipDisplay: 'short' }), 'pic-1')
  assert.equal(T.displayNameFor('pic-1.webp', { chipDisplay: 'short' }), 'pic-1')
  assert.equal(T.displayNameFor('pic-1.png', { chipDisplay: 'full' }), 'pic-1.png')
  assert.equal(T.displayNameFor('noext', { chipDisplay: 'short' }), 'noext')
  assert.equal(T.displayNameFor('', { chipDisplay: 'short' }), '')
})

test('词库：中英键一一对应（漏翻会在这里炸）', () => {
  const zh = Object.keys(T.I18N.zh).sort()
  const en = Object.keys(T.I18N.en).sort()
  assert.deepEqual(en, zh)
  assert.equal(T.translate('zh', 'nav.title'), '混合排版')
  assert.equal(T.translate('en', 'nav.title'), 'Mixed layout')
  assert.equal(T.translate('en', 'page.title'), 'Composer image & text layout')
  assert.equal(T.translate('en', 'not.a.key'), 'not.a.key', '缺键回显 key，不显示 undefined')
})

test('resolveLang：设置强制 > DSH 界面语言 > 浏览器语言', () => {
  assert.equal(T.resolveLang({ lang: 'en' }, { getLocale: () => ({ active: 'zh' }) }), 'en')
  assert.equal(T.resolveLang({ lang: 'zh' }, { getLocale: () => ({ active: 'en' }) }), 'zh')
  assert.equal(T.resolveLang({ lang: 'auto' }, { getLocale: () => ({ active: 'zh-CN' }) }), 'zh')
  assert.equal(T.resolveLang({ lang: 'auto' }, { getLocale: () => ({ active: 'en-US' }) }), 'en')
  /* locale 炸掉 / 缺失时不能抛 */
  assert.equal(
    T.resolveLang({ lang: 'auto' }, {
      getLocale: () => {
        throw new Error('boom')
      },
    }),
    'zh',
  )
  assert.equal(['zh', 'en'].includes(T.resolveLang({ lang: 'auto' }, undefined)), true)
})

/* ---------------- 设置页组件 ---------------- */

const renderPanel = (overrides = {}) => {
  const react = createReact()
  const Panel = T.createSettingsPanel(react)
  const tree = render(react, Panel, { subscribeLocale: () => () => {}, ...overrides })
  return { react, tree, text: textOf(tree) }
}

test('面板：标题 / 归属 / 项目地址 / 默认文案都在', () => {
  fresh()
  const { tree, text } = renderPanel()
  assert.match(text, /输入框图文混排设置/)
  assert.match(text, /@qgynisc\/dsh-inline-pastes/)
  assert.match(text, /https:\/\/github\.com\/qgynisc\/dsh-inline-pastes/)
  assert.match(text, /混合排版|界面语言/)
  /* 仓库与 npm 都是真链接 */
  const links = findByTag(tree, 'a').map((element) => element.props.href)
  assert.deepEqual(links, ['https://www.npmjs.com/package/@qgynisc/dsh-inline-pastes', 'https://github.com/qgynisc/dsh-inline-pastes'])
})

test('面板：切到 English 后整页文案变英文，切回中文也立刻变', () => {
  fresh()
  T.updateSettings({ lang: 'en' })
  const en = renderPanel()
  assert.match(en.text, /Composer image & text layout/)
  assert.match(en.text, /Repository/)
  assert.match(en.text, /Enable plugin/)
  assert.match(en.text, /Restore defaults/)
  assert.doesNotMatch(en.text, /输入框图文混排设置/)
  T.updateSettings({ lang: 'zh' })
  const zh = renderPanel()
  assert.match(zh.text, /输入框图文混排设置/)
  assert.match(zh.text, /恢复默认设置/)
  fresh()
})

test('面板：胶囊预览随「短名/完整名」与前缀变', () => {
  fresh()
  const short = renderPanel()
  assert.deepEqual(findByClass(short.tree, 'dsh-ip-set-chip').map((element) => textOf(element)), ['pic-1'])
  T.updateSettings({ chipDisplay: 'full' })
  const full = renderPanel()
  assert.deepEqual(findByClass(full.tree, 'dsh-ip-set-chip').map((element) => textOf(element)), ['pic-1.png'])
  T.updateSettings({ prefixes: { image: 'shot' } })
  const custom = renderPanel()
  assert.deepEqual(findByClass(custom.tree, 'dsh-ip-set-chip').map((element) => textOf(element)), ['shot-1.png'])
  fresh()
})

test('面板：角标预览跟随档位（含「关」）', () => {
  fresh()
  const md = findByClass(renderPanel().tree, 'dsh-ip-badge')
  assert.deepEqual(md.map((element) => element.props.className), ['dsh-ip-badge dsh-ip-badge--md'])
  T.updateSettings({ badgeSize: 'lg' })
  assert.deepEqual(
    findByClass(renderPanel().tree, 'dsh-ip-badge').map((element) => element.props.className),
    ['dsh-ip-badge dsh-ip-badge--lg'],
  )
  T.updateSettings({ badgeSize: 'off' })
  assert.equal(findByClass(renderPanel().tree, 'dsh-ip-badge').length, 0, '关掉时不该再画角标样例')
  fresh()
})

test('面板：控件真的写进设置（下拉连的是活设置对象）', () => {
  const s = fresh()
  const { tree } = renderPanel()
  const selects = findByTag(tree, 'select')
  /* 语言 / 前缀 / 胶囊显示 / 角标 四个下拉 */
  assert.equal(selects.length, 4)
  selects[3].props.onChange({ target: { value: 'lg' } })
  assert.equal(s.badgeSize, 'lg')
  selects[2].props.onChange({ target: { value: 'full' } })
  assert.equal(s.chipDisplay, 'full')
  selects[0].props.onChange({ target: { value: 'en' } })
  assert.equal(s.lang, 'en')
  /* 勾选项也是一条线：复选框直接落到 enabled / hoverPreview 上 */
  const boxes = findByTag(tree, 'input').filter((element) => element.props.type === 'checkbox')
  assert.equal(boxes.length, 6)
  boxes[0].props.onChange({ target: { checked: false } })
  assert.equal(s.enabled, false)
  boxes[2].props.onChange({ target: { checked: false } })
  assert.equal(s.hoverPreview, false)
  fresh()
})

/* ---------------- 槽注册 ---------------- */

const fakeCtx = () => {
  const registered = []
  const slots = {
    register: (descriptor, component) => {
      registered.push({ descriptor, component })
      return () => {}
    },
    inject: (name, callback) => {
      callback()
      return () => {}
    },
  }
  const locale = {
    register: () => () => {},
    getLocale: () => ({ active: 'zh' }),
    subscribe: () => () => {},
  }
  const ctx = {
    get: (name) => (name === 'slots' ? slots : name === 'locale' ? locale : undefined),
    inject: (services, callback) => {
      callback({ get: (name) => (name === 'slots' ? slots : name === 'locale' ? locale : undefined) })
      return () => {}
    },
    effect: (callback) => {
      const off = callback()
      return () => {
        if (typeof off === 'function') off()
      }
    },
  }
  return { ctx, registered }
}

test('设置页注册：槽名 / id / 排序 / 语言跟随都正确', () => {
  fresh()
  const { ctx, registered } = fakeCtx()
  const dispose = T.installSettingsPage(ctx, createReact(), () => {})
  assert.equal(registered.length, 1)
  const { descriptor, component } = registered[0]
  assert.equal(descriptor.name, 'settings.section')
  assert.equal(descriptor.id, 'inline-pastes')
  assert.equal(descriptor.locale, T.SETTINGS_NS)
  assert.equal(typeof descriptor.order, 'number')
  assert.equal(descriptor.label(), '混合排版')
  /* 组件本身能渲染（此刻还是中文） */
  const react = createReact()
  assert.match(textOf(render(react, component)), /输入框图文混排设置/)
  T.updateSettings({ lang: 'en' })
  assert.equal(descriptor.label(), 'Mixed layout', '左侧导航那行字也要跟着语言走')
  assert.match(textOf(render(react, component)), /Composer image & text layout/)
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(() => dispose())
  fresh()
})

test('总开关不能把设置页一起关掉（否则用户再也开不回来）', async () => {
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  /* 设置存在 localStorage：若启动时 enabled=false 就早退，设置页也不会装 —— 用户没有入口把它开回来。
   * 行为一律改成运行时判断，所以「提前 return」这件事必须在产物里绝迹。 */
  assert.equal(/if \(settings\.enabled !== true\)\s*return/.test(code), false, '总开关不能是 apply 的提前 return')
  const gates = [...code.matchAll(/settings\.enabled !== true/g)].length
  assert.ok(gates >= 4, `粘贴/预览/自检/角标都要各自检查总开关（现在只有 ${gates} 处）`)
})

test('拿不到 React 时：设置页整块跳过，不注册也不抛', () => {
  fresh()
  const { ctx, registered } = fakeCtx()
  const warned = []
  assert.doesNotThrow(() => T.installSettingsPage(ctx, undefined, (message) => warned.push(message)))
  assert.equal(registered.length, 0)
  assert.equal(warned.length, 1)
  fresh()
})
