/* ---------------------------------------------------------------------------
 * 10.5 设置页：左侧「混合排版」+ 右侧面板（DSH 的 settings.section 槽）
 *
 * 本文件由 scripts/build.mjs 内联进 src/client.js 的 `/*__PANEL__*\/ ''` 锚点，
 * 与 client.js 共用同一个模块作用域（所以能直接用 settings / updateSettings /
 * displayNameFor / VERSION 等）。单独成文件只为可读性。
 *
 * 三条纪律：
 *   1. 设置页是**可选装饰**：拿不到 React / slots / locale 就整块跳过，
 *      绝不因为它而影响粘贴、胶囊、悬浮预览、角标（apply 里用 try/catch 兜住）。
 *   2. 组件直接读模块作用域的活设置对象 settings，改设置调 updateSettings —— 
 *      面板里看到的就是插件正在用的那一份，不存在两份状态。
 *   3. 界面语言：'auto' 时跟随 DSH 界面语言（locale.getLocale().active），
 *      也可以在本页强制中文/English。
 * ------------------------------------------------------------------------- */

/** 面板里展示的项目信息（点得动）。 */
const REPO_URL = 'https://github.com/qgynisc/dsh-inline-pastes'
const NPM_URL = 'https://www.npmjs.com/package/@qgynisc/dsh-inline-pastes'
const PLUGIN_NAME = '@qgynisc/dsh-inline-pastes'

/** 本插件在 DSH locale 服务里注册的词库命名空间。 */
const SETTINGS_NS = 'dsh-inline-pastes'

/** 面板排序（越小越靠上）；45/50 已被提醒音与状态轮播插件占了。 */
const SETTINGS_ORDER = 60

/** 设置页的槽名。 */
const SETTINGS_SLOT = 'settings.section'

/** 词库：key → { zh, en }。加文案只改这一张表。 */
const I18N = {
  zh: {
    'nav.title': '混合排版',
    'page.title': '输入框图文混排设置',
    'page.byline': '本项目由插件',
    'page.bylineTail': '实现',
    'page.repo': '项目地址',
    'page.version': '版本',
    'lang.label': '界面语言',
    'lang.auto': '跟随 DSH',
    'lang.zh': '中文',
    'lang.en': 'English',
    'prefix.label': '命名前缀',
    'prefix.custom': '自定义…',
    'prefix.input': '自定义前缀',
    'prefix.invalid': '只能用字母数字（可含 - 和 _），并以字母或数字开头',
    'chip.label': '胶囊显示',
    'chip.short': '短名（省空间）',
    'chip.full': '完整文件名',
    'chip.hint': '只影响胶囊里显示什么：发送出去的文本、附件名、模型看到的名字，始终是完整文件名。',
    'badge.label': '缩略图角标',
    'badge.off': '关',
    'badge.sm': '小',
    'badge.md': '中',
    'badge.lg': '大',
    'badge.hint': '缩略图左下角那个序号的大小。',
    'section.behavior': '行为',
    'enabled.label': '启用插件',
    'enabled.hint': '关掉后完全退回官方行为：不接管粘贴、不插胶囊、不挂角标。',
    'intercept.label': '接管图片粘贴',
    'intercept.hint': '关掉后图片只进官方附件轨，不再插内联名字。',
    'hover.label': '名字悬浮预览',
    'hover.hint': '鼠标停在内联胶囊或气泡里的名字上，弹出缩略图预览卡。',
    'meta.label': '预览卡显示尺寸与体积',
    'audit.label': '发送前自检',
    'audit.hint': '文字里点名的图片在本条消息里找不到、或同一个名字出现两次时，在输入框上方提示一句。',
    'block.label': '自检不通过时拦一次回车',
    'block.hint': '再按一次回车照常发送 —— 保险，不是门禁。',
    'sample.chip': '胶囊预览',
    'sample.sent': '实际发送',
    'sample.badge': '角标预览',
    'reset.label': '恢复默认设置',
    'reset.hint': '全部选项回到默认值（编号计数不受影响）。',
    'reset.confirm': '恢复全部设置到默认值？',
  },
  en: {
    'nav.title': 'Mixed layout',
    'page.title': 'Composer image & text layout',
    'page.byline': 'Implemented by the plugin',
    'page.bylineTail': '',
    'page.repo': 'Repository',
    'page.version': 'Version',
    'lang.label': 'Language',
    'lang.auto': 'Follow DSH',
    'lang.zh': '中文',
    'lang.en': 'English',
    'prefix.label': 'Name prefix',
    'prefix.custom': 'Custom…',
    'prefix.input': 'Custom prefix',
    'prefix.invalid': 'Letters and digits only (may contain - and _), starting with a letter or digit',
    'chip.label': 'Chip label',
    'chip.short': 'Short (saves space)',
    'chip.full': 'Full file name',
    'chip.hint': 'Display only: the text that is sent, the attachment name and the name the model sees are always the full file name.',
    'badge.label': 'Thumbnail badge',
    'badge.off': 'Off',
    'badge.sm': 'Small',
    'badge.md': 'Medium',
    'badge.lg': 'Large',
    'badge.hint': 'Size of the sequence number in the thumbnail\u2019s lower-left corner.',
    'section.behavior': 'Behavior',
    'enabled.label': 'Enable plugin',
    'enabled.hint': 'When off, everything falls back to the official behavior: no paste takeover, no chips, no badges.',
    'intercept.label': 'Intercept image pastes',
    'intercept.hint': 'When off, images only go to the official attachment track.',
    'hover.label': 'Hover preview',
    'hover.hint': 'Pause the pointer on an inline chip or a name inside a message to preview the image.',
    'meta.label': 'Show dimensions & size on the card',
    'audit.label': 'Pre-send audit',
    'audit.hint': 'Warn above the composer when a named image is missing from this message or a name appears twice.',
    'block.label': 'Hold the first Enter when the audit fails',
    'block.hint': 'A second Enter sends anyway — a safety net, not a gate.',
    'sample.chip': 'Chip preview',
    'sample.sent': 'Sent as',
    'sample.badge': 'Badge preview',
    'reset.label': 'Restore defaults',
    'reset.hint': 'Reset every option to its default (sequence counters are untouched).',
    'reset.confirm': 'Restore all settings to their defaults?',
  },
}

/** locale 服务（installSettingsPage 拿到后放这儿，供 resolveLang 用）。 */
let localeService = null

/**
 * 当前界面语言：设置页强制了就用强制的，否则跟随 DSH 界面语言，最后退回浏览器语言。
 * @param config - 设置对象。
 * @param locale - DSH 的 locale 服务（可空）。
 * @returns 'zh' | 'en'
 */
function resolveLang(config, locale) {
  const forced = config?.lang
  if (forced === 'zh' || forced === 'en') return forced
  let active
  try {
    active = locale?.getLocale?.()?.active
  } catch (error) {
    active = undefined
  }
  if (typeof active === 'string' && active !== '') return active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  try {
    const nav = globalThis.navigator?.language
    if (typeof nav === 'string' && nav !== '') return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch (error) {
    /* 没有 navigator 就用默认语言 */
  }
  return 'zh'
}

/**
 * 取文案。
 * @param lang - 'zh' | 'en'。
 * @param key - 词库键。
 * @returns 文案（缺键退回中文，再缺就回显 key，绝不显示 undefined）。
 */
function translate(lang, key) {
  const dict = I18N[lang] ?? I18N.zh
  const text = dict[key] ?? I18N.zh[key]
  return text === undefined ? key : text
}

/**
 * 造设置页组件。
 *
 * 刻意只用 useState / useEffect（不碰 useMemo / 自定义 hook）：面板要能在最简的
 * React 环境里渲染 —— 真机上是 DSH 内置设置页同一份 React，测试里是一个极小的替身。
 * @param react - require('react') 的结果。
 * @returns React 组件。
 */
function createSettingsPanel(react) {
  const h = react.createElement

  /** 一行：左侧标签，右侧控件（有说明时说明挂在控件下方，跟真机设置页一个观感）。 */
  const row = (key, label, control, hint) =>
    h(
      'div',
      { key, className: 'dsh-ip-set-row' },
      h('div', { className: 'dsh-ip-set-side' }, h('span', { className: 'dsh-ip-set-label' }, label)),
      h(
        'div',
        { className: hint === undefined ? 'dsh-ip-set-control' : 'dsh-ip-set-control dsh-ip-set-control--stack' },
        control,
        hint === undefined ? null : h('span', { className: 'dsh-ip-set-hint' }, hint),
      ),
    )

  /** 勾选项：复选框 + 标签 + 说明（说明换行显示在下方）。 */
  const toggle = (key, label, hint, checked, onChange) =>
    h(
      'div',
      { key, className: 'dsh-ip-set-row dsh-ip-set-row--toggle' },
      h('label', { className: 'dsh-ip-set-check' }, h('input', { type: 'checkbox', checked, onChange: (event) => onChange(!!event.target.checked) }), h('span', null, label)),
      hint === undefined ? null : h('span', { className: 'dsh-ip-set-hint dsh-ip-set-hint--under' }, hint),
    )

  /** 下拉。 */
  const select = (key, value, onChange, options) =>
    h(
      'select',
      { key, className: 'dsh-ip-set-select', value, onChange: (event) => onChange(event.target.value) },
      options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
    )

  return function SettingsPanel(props) {
    /* 只为强制重渲染：真正的数据每次都从活设置对象读，绝不缓存一份副本 */
    const [, bump] = react.useState(0)
    /* 自定义前缀的输入草稿：允许「清空重打」，合法值才写回设置 */
    const [prefixDraft, setPrefixDraft] = react.useState(null)
    const subscribeLocale = typeof props?.subscribeLocale === 'function' ? props.subscribeLocale : () => () => {}
    react.useEffect(() => {
      const offSettings = subscribeSettings(() => bump((n) => n + 1))
      const offLocale = subscribeLocale(() => bump((n) => n + 1))
      return () => {
        offSettings()
        offLocale()
      }
    }, [])

    const s = settings
    const lang = resolveLang(s, localeService)
    const t = (key) => translate(lang, key)

    const prefix = prefixFor(s, 'image')
    const exampleFull = `${prefix}-1.png`
    const exampleChip = displayNameFor(exampleFull, s)
    const customPrefix = !['pic', 'image'].includes(prefix)
    const prefixValue = prefixDraft ?? prefix
    const badgeSize = BADGE_SIZES.includes(s.badgeSize) ? s.badgeSize : 'md'

    /* 命名前缀：pic / image 两个常用值 + 自定义输入 */
    const prefixOptions = [
      { value: 'pic', label: 'pic  →  pic-1' },
      { value: 'image', label: 'image  →  image-1' },
      { value: '__custom__', label: t('prefix.custom') },
    ]
    const prefixControl = h(
      'div',
      { className: 'dsh-ip-set-stack' },
      select(
        'prefix',
        customPrefix ? '__custom__' : prefix,
        (value) => {
          if (value === '__custom__') {
            setPrefixDraft(null)
            return
          }
          setPrefixDraft(null)
          updateSettings({ prefixes: { image: value } })
        },
        prefixOptions,
      ),
      customPrefix
        ? h('input', {
            type: 'text',
            className: 'dsh-ip-set-text',
            value: prefixValue,
            placeholder: t('prefix.input'),
            spellCheck: false,
            onChange: (event) => {
              const value = String(event.target.value ?? '').trim()
              setPrefixDraft(value)
              /* 合法才写回：非法时只更新草稿（下面给红字提示），不把设置写坏 */
              if (PREFIX_PATTERN.test(value)) updateSettings({ prefixes: { image: value } })
            },
          })
        : null,
      customPrefix && !PREFIX_PATTERN.test(prefixValue) ? h('span', { className: 'dsh-ip-set-warn' }, t('prefix.invalid')) : null,
    )

    /* 胶囊预览 + 实际发送的名字 + 角标预览：一眼看清「显示」与「发送」的差别 */
    const chipPreview = h(
      'div',
      { className: 'dsh-ip-set-sample' },
      h('span', { className: 'dsh-ip-set-sample-title' }, t('sample.chip')),
      h('span', { className: 'dsh-ip-set-chip' }, exampleChip),
      h('span', { className: 'dsh-ip-set-sample-tail' }, `${t('sample.sent')} ${exampleFull}`),
      h('span', { className: 'dsh-ip-set-sample-title' }, t('sample.badge')),
      h(
        'span',
        { className: 'dsh-ip-set-thumb' },
        badgeSize === 'off' ? h('span', { className: 'dsh-ip-set-warn' }, '—') : h('span', { className: `dsh-ip-badge dsh-ip-badge--${badgeSize}` }, '3'),
      ),
    )

    return h(
      'div',
      { className: 'dsh-ip-set' },
      /* 标题 + 归属 + 项目地址 */
      h('div', { className: 'dsh-ip-set-head' },
        h('div', { className: 'dsh-ip-set-title' }, t('page.title')),
        h('div', { className: 'dsh-ip-set-sub' },
          `${t('page.byline')} `,
          h('a', { href: NPM_URL, target: '_blank', rel: 'noreferrer' }, PLUGIN_NAME),
          t('page.bylineTail') === '' ? null : ` ${t('page.bylineTail')}`,
          ` · ${t('page.version')} ${VERSION}`,
        ),
        h('div', { className: 'dsh-ip-set-sub' },
          `${t('page.repo')}：`,
          h('a', { href: REPO_URL, target: '_blank', rel: 'noreferrer' }, REPO_URL),
        ),
      ),

      row('lang', t('lang.label'), select('lang', s.lang, (value) => updateSettings({ lang: value }), [
        { value: 'auto', label: t('lang.auto') },
        { value: 'zh', label: t('lang.zh') },
        { value: 'en', label: t('lang.en') },
      ])),
      row('prefix', t('prefix.label'), prefixControl),
      row('chip', t('chip.label'), select('chip', s.chipDisplay, (value) => updateSettings({ chipDisplay: value }), [
        { value: 'short', label: `${t('chip.short')}  ${exampleChip}` },
        { value: 'full', label: `${t('chip.full')}  ${exampleFull}` },
      ]), t('chip.hint')),
      row('badge', t('badge.label'), select('badge', s.badgeSize, (value) => updateSettings({ badgeSize: value }), [
        { value: 'off', label: t('badge.off') },
        { value: 'sm', label: t('badge.sm') },
        { value: 'md', label: t('badge.md') },
        { value: 'lg', label: t('badge.lg') },
      ]), t('badge.hint')),
      chipPreview,

      h('div', { className: 'dsh-ip-set-section' }, t('section.behavior')),
      toggle('enabled', t('enabled.label'), t('enabled.hint'), s.enabled === true, (value) => updateSettings({ enabled: value })),
      toggle('intercept', t('intercept.label'), t('intercept.hint'), s.interceptPaste === true, (value) => updateSettings({ interceptPaste: value })),
      toggle('hover', t('hover.label'), t('hover.hint'), s.hoverPreview === true, (value) => updateSettings({ hoverPreview: value })),
      toggle('meta', t('meta.label'), undefined, s.showMeta === true, (value) => updateSettings({ showMeta: value })),
      toggle('audit', t('audit.label'), t('audit.hint'), s.auditBeforeSend === true, (value) => updateSettings({ auditBeforeSend: value })),
      toggle('block', t('block.label'), t('block.hint'), s.blockOnAuditFailure === true, (value) => updateSettings({ blockOnAuditFailure: value })),

      h('div', { className: 'dsh-ip-set-row' },
        h('div', { className: 'dsh-ip-set-control' },
          h('button', {
            type: 'button',
            className: 'dsh-ip-set-btn',
            onClick: () => {
              if (typeof globalThis.confirm !== 'function' || globalThis.confirm(t('reset.confirm')) !== false) resetSettings()
            },
          }, t('reset.label')),
          h('span', { className: 'dsh-ip-set-hint' }, t('reset.hint')),
        ),
      ),
    )
  }
}

/**
 * 装设置页：注册词库 + 把面板挂到 `settings.section` 槽。
 *
 * 服务用 `ctx.inject(['slots','locale'], …)` 等服务就绪（早退式的 `ctx.get` 在服务晚到时
 * 会**永久**不注册 —— @machine-126 的插件注释里专门记了这个坑）。
 * @param ctx - 客户端上下文。
 * @param react - require('react') 的结果；拿不到就整块跳过。
 * @param report - 告警函数（console.warn）。
 * @returns 卸载函数。
 */
function installSettingsPage(ctx, react, report) {
  if (react === null || react === undefined || typeof react.createElement !== 'function') {
    report('react unavailable; settings page disabled', undefined)
    return () => {}
  }
  const disposers = []
  const install = (scope) => {
    const get = typeof scope?.get === 'function' ? (name) => scope.get(name) : (name) => service(ctx, name)

    /* 1) 词库：注册进 DSH 的 locale 服务（拿不到也无所谓，面板自己那份词库照用） */
    const locale = get('locale')
    if (locale !== null && locale !== undefined) {
      localeService = locale
      if (typeof locale.register === 'function') {
        try {
          const off = typeof ctx.effect === 'function' ? ctx.effect(() => locale.register(SETTINGS_NS, I18N), 'dsh-inline-pastes: locale dictionaries') : locale.register(SETTINGS_NS, I18N)
          if (typeof off === 'function') disposers.push(off)
        } catch (error) {
          report('register locale dictionaries failed', error)
        }
      }
    }

    /* 2) 面板：挂到设置页的 settings.section 槽 */
    const slots = get('slots')
    if (slots === null || slots === undefined || typeof slots.register !== 'function') {
      report('slots service unavailable; settings page disabled', undefined)
      return
    }
    const panel = createSettingsPanel(react)
    const component = (props) =>
      react.createElement(panel, {
        ...props,
        /* DSH 切界面语言时重渲染（settings.lang='auto' 时面板文案跟着变） */
        subscribeLocale: (listener) => {
          try {
            return typeof locale?.subscribe === 'function' ? locale.subscribe(listener) : () => {}
          } catch (error) {
            return () => {}
          }
        },
      })
    const descriptor = {
      name: SETTINGS_SLOT,
      id: 'inline-pastes',
      order: SETTINGS_ORDER,
      /* 左侧导航那行字：跟随界面语言 */
      label: () => translate(resolveLang(settings, localeService), 'nav.title'),
      locale: SETTINGS_NS,
    }
    const register = () => slots.register(descriptor, component)
    try {
      /* 与内置设置页、其它插件一致的注册姿势：先等槽就绪，再注册 */
      const off = typeof slots.inject === 'function' ? slots.inject(SETTINGS_SLOT, register) : register()
      if (typeof off === 'function') disposers.push(off)
    } catch (error) {
      report('register settings section failed', error)
    }
  }

  try {
    if (typeof ctx.inject === 'function') {
      const off = ctx.inject(['slots', 'locale'], (scope) => {
        try {
          install(scope)
        } catch (error) {
          report('install settings page failed', error)
        }
      })
      if (typeof off === 'function') disposers.push(off)
    } else {
      install(ctx)
    }
  } catch (error) {
    report('settings page unavailable', error)
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        /* 卸载失败不影响别处 */
      }
    }
  }
}
