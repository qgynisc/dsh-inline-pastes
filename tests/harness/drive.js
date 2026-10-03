/**
 * 浏览器端端到端驱动：在**真实 Chrome** 里装载构建产物，用假 ctx 模拟官方服务，
 * 然后真的派发 paste / pointermove 事件，检查
 *   ① 光标处出现内联胶囊且名字编号正确；
 *   ② 悬浮胶囊弹预览卡；
 *   ③ 悬浮已发送气泡里的同名文字也弹预览卡；
 *   ④ 没登记的名字不弹；
 *   ⑤ 混有非图片文件的粘贴原样放行（不 preventDefault）。
 *
 * 结果同时写进 DOM（#results）并 POST 回 verify-browser.mjs 的静态服务器。
 */
/* global window, document, File, DataTransfer, ClipboardEvent, PointerEvent, fetch */
;(function () {
  const results = []
  const editor = document.getElementById('editor')
  const bubble = document.getElementById('bubble')
  const output = document.getElementById('results')

  const check = (name, ok, detail) => results.push({ name, ok: ok === true, detail: detail === undefined ? '' : String(detail) })
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function imageFile(name, type, bytes) {
    return new File([new Uint8Array(bytes ?? 32)], name, { type })
  }

  /* ---------------- 假 ctx：只实现插件真正用到的面 ---------------- */

  function makeEnv() {
    const spy = { created: [], inserted: [], attachments: [], released: [], pasted: [], notices: [] }
    const state = { phase: 'plain', draft: '', attachmentIds: [], draftRev: 0, occurrences: [] }
    let draftSeq = 0
    const draftRegistry = new Map()

    const stateListeners = new Set()
    const publish = () => {
      for (const listener of [...stateListeners]) listener()
    }
    const noticeStore = {
      value: null,
      getSnapshot: () => noticeStore.value,
      set: (value) => {
        noticeStore.value = value
      },
    }

    const shell = {
      state: {
        getSnapshot: () => ({ ...state, attachmentIds: [...state.attachmentIds], occurrences: [...state.occurrences] }),
        subscribe: (listener) => {
          stateListeners.add(listener)
          return () => stateListeners.delete(listener)
        },
      },
      notices: noticeStore,
      notify(level, text) {
        spy.notices.push({ level, text })
        noticeStore.set({ level, text, seq: spy.notices.length })
      },
      actions: {
        captureInsertion: () => ({ start: 0, end: 0, draftRev: state.draftRev }),
        addAttachments(ids) {
          spy.attachments.push(...ids)
          state.attachmentIds.push(...ids)
          publish()
          return true
        },
      },
      insertReference(ref, span) {
        spy.inserted.push({ ref, span })
        /* 模拟官方胶囊的真实 DOM：data-composer-chip + contenteditable=false */
        const chip = document.createElement('span')
        chip.setAttribute('data-composer-chip', ref.source)
        chip.setAttribute('contenteditable', 'false')
        const body = document.createElement('span')
        body.textContent = ref.label
        chip.append(body)
        editor.append(chip)
        editor.append(document.createTextNode(' '))
        state.draft += `${ref.clipboardText} `
        state.occurrences.push({ source: ref.source, ref: ref.ref, label: ref.label, clipboardText: ref.clipboardText })
        state.draftRev += 1
        publish()
        return true
      },
      paste(text) {
        spy.pasted.push(text)
      },
    }

    const conversation = {
      input: { for: () => shell },
      createDrafts: (sessionId, files) => {
        spy.created.push(...files)
        return files.map((file) => {
          const descriptor = { kind: 'image', id: `draft-${++draftSeq}`, file, previewUrl: `blob:mock-${draftSeq}` }
          draftRegistry.set(descriptor.id, descriptor)
          return descriptor
        })
      },
      resolveDraftAttachments: (ids) => ids.map((id) => draftRegistry.get(id) ?? { kind: 'image', id }),
      releaseDraftAttachments: (items) => spy.released.push(...items.map((item) => item.id)),
    }

    /** 本插件向 input-trigger 管道注册的 source（发送时要靠它的 codec 序列化胶囊）。 */
    const registeredSources = []
    const ctx = {
      get(name) {
        if (name === 'conversation') return conversation
        if (name === 'uiSession') return { current: { getSnapshot: () => ({ key: 'session-harness', ctx: {} }) } }
        if (name === 'sessions') return { list: { getSnapshot: () => ({ ids: [], byId: {} }) }, scope: () => ({}), binding: () => undefined }
        if (name === 'inputTriggers') {
          return {
            registerSource(source) {
              registeredSources.push(source)
              return () => {
                const index = registeredSources.indexOf(source)
                if (index >= 0) registeredSources.splice(index, 1)
              }
            },
          }
        }
        return undefined
      },
      effect: (fn) => fn(),
    }
    /** 模拟「发送了一条消息」：草稿、附件、胶囊全部清空。 */
    const send = () => {
      state.draft = ''
      state.attachmentIds = []
      state.occurrences = []
      state.draftRev += 1
      publish()
    }

    /** 模拟外部改动（例如用户从 dock 里删掉一张缩略图）。 */
    const patch = (next) => {
      Object.assign(state, next)
      state.draftRev += 1
      publish()
    }

    return { ctx, spy, shell, state, send, patch, registeredSources }
  }

  /* ---------------- 事件工厂 ---------------- */

  function clipboardWith(files, text) {
    const data = new DataTransfer()
    for (const file of files) data.items.add(file)
    if (text) data.setData('text/plain', text)
    return data
  }

  function paste(data, target) {
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    ;(target ?? editor).dispatchEvent(event)
    return event
  }

  function pointerAt(x, y) {
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
  }

  function centerOf(element) {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  /** 名字在气泡里的矩形（用 Range 取，避免整行中点落在文字外面）。 */
  function rectOfText(root, needle) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const at = node.data.indexOf(needle)
      if (at >= 0) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        return range.getBoundingClientRect()
      }
      node = walker.nextNode()
    }
    return null
  }

  const card = () => document.querySelector('.dsh-ip-card')

  /* ---------------- 断言 ---------------- */

  async function run() {
    const module = window.__pluginModule
    /* id 必须等于 package.json 的 name：写死字符串会在包改名（如加 npm scope）后静静过期，
     * 所以这里现读 package.json（静态服务器就服务仓库根目录）。 */
    let expectedId = null
    try {
      expectedId = (await fetch('/package.json').then((response) => response.json())).name
    } catch {
      /* 读不到就只能拿实际 id 报告，断言会失败并显示它 */
    }
    check('bundle 注册到 __ModuleLoader__ 且 id 正确', module !== undefined && module.id === expectedId, module && module.id)
    if (module === undefined) return finish()

    const mod = module.factory(() => {
      throw new Error('不应有平台模块解析')
    })
    const env = makeEnv()
    const { ctx, spy, state, send, patch, registeredSources } = env
    mod.apply(ctx)
    check('样式已注入', document.querySelector('style[data-dsh-inline-pastes]') !== null)
    check('预览卡已挂到 body', card() !== null)

    /* 官方在发送时会按 source 找 codec 序列化（缺了就报
     * slash: no serializer for reference source "inline-paste" 并拦下发送） */
    const source = registeredSources[0]
    check('向 inputTriggers 注册了引用 source', registeredSources.length === 1 && source?.name === 'inline-paste', source?.name)
    check('触发符不是 @ 或 /（否则会挤进官方菜单）', source?.trigger !== '@' && source?.trigger !== '/', JSON.stringify(source?.trigger))
    check('codec 具备 serialize', typeof source?.codec?.serialize === 'function')
    if (typeof source?.codec?.serialize === 'function') {
      const serialized = await source.codec.serialize('dsh-inline-paste:image-1.png')
      check('codec.serialize 还原出模型侧的名字', serialized === 'image-1.png', String(serialized))
      const clipboard = typeof source.codec.clipboardText === 'function' ? source.codec.clipboardText('dsh-inline-paste:image-9.png') : undefined
      check('codec.clipboardText 与之一致', clipboard === 'image-9.png', String(clipboard))
    }

    /* ① 粘贴第一张图：胶囊 + 编号 + 挂附件 */
    const first = paste(clipboardWith([imageFile('image.png', 'image/png')]))
    check('粘贴被接管（preventDefault）', first.defaultPrevented === true)
    const chips = () => [...editor.querySelectorAll('[data-composer-chip="inline-paste"]')]
    check('光标处出现内联胶囊', chips().length === 1, `chips=${chips().length}`)
    check('胶囊文字是 image-1.png', chips()[0]?.textContent === 'image-1.png', chips()[0]?.textContent)
    check('发送文本（clipboardText）就是 image-1.png', state.draft.trim() === 'image-1.png', state.draft)
    check('重命名后的 File 名 = image-1.png', spy.created[0]?.name === 'image-1.png', spy.created[0]?.name)
    check('胶囊 ref 里带着名字（发送时靠它序列化）', spy.inserted[0]?.ref?.ref === 'dsh-inline-paste:image-1.png', spy.inserted[0]?.ref?.ref)
    check('草稿附件已挂上', JSON.stringify(spy.attachments) === JSON.stringify(['draft-1']), JSON.stringify(spy.attachments))

    /* ② 悬浮胶囊 → 预览卡 */
    await sleep(30)
    const chipCenter = centerOf(chips()[0])
    pointerAt(chipCenter.x, chipCenter.y)
    await sleep(420)
    const opened = card()
    check('悬浮胶囊弹出预览卡', opened.dataset.open === 'true', `data-open=${opened.dataset.open}`)
    check('预览卡显示的是这张图', (opened.querySelector('img').src || '').startsWith('blob:'), opened.querySelector('img').src.slice(0, 24))
    check('预览卡带文件名', opened.querySelector('.dsh-ip-name').textContent === 'image-1.png', opened.querySelector('.dsh-ip-name').textContent)

    /* 移开 → 收卡 */
    pointerAt(5, document.body.scrollHeight - 5)
    await sleep(120)
    check('移开后收起预览卡', card().dataset.open !== 'true', `data-open=${card().dataset.open}`)

    /* ③ 已发送气泡里的同名文字 → 预览卡 */
    bubble.textContent = '3、修改bug如图： image-1.png ，把它变成可自动定位。'
    await sleep(30)
    const textRect = rectOfText(bubble, 'image-1.png')
    check('气泡里能找到名字文本', textRect !== null && textRect.width > 0)
    if (textRect !== null) {
      pointerAt(textRect.left + textRect.width / 2, textRect.top + textRect.height / 2)
      await sleep(420)
      check('悬浮气泡里的名字也弹预览卡', card().dataset.open === 'true', `data-open=${card().dataset.open}`)
    }

    /* ④ 没登记的名字不弹 */
    bubble.textContent = '这里写的是 image-99.png，没登记过。'
    await sleep(30)
    const missRect = rectOfText(bubble, 'image-99.png')
    if (missRect !== null) {
      pointerAt(missRect.left + missRect.width / 2, missRect.top + missRect.height / 2)
      await sleep(420)
      check('未登记的名字不弹预览卡', card().dataset.open !== 'true', `data-open=${card().dataset.open}`)
    }

    /* ⑤ 第二张图继续编号 */
    paste(clipboardWith([imageFile('image.png', 'image/png')]))
    check('第二张图编号为 image-2.png', chips()[1]?.textContent === 'image-2.png', chips()[1]?.textContent)

    /* ⑥ 混有非图片文件的粘贴原样放行 */
    const mixed = clipboardWith([imageFile('x.png', 'image/png'), imageFile('x.pdf', 'application/pdf')])
    const mixedEvent = paste(mixed)
    check('混有非图片文件时不接管', mixedEvent.defaultPrevented === false)
    check('混有非图片文件时不加胶囊', chips().length === 2, `chips=${chips().length}`)

    /* ⑦ 图片 + 文字：文字按官方顺序补上 */
    const withText = clipboardWith([imageFile('image.png', 'image/png')], '1、功能1 ')
    withText.setData('text/plain', '1、功能1 ')
    paste(withText)
    check('剪贴板里的文字被补插', spy.pasted.includes('1、功能1 '), JSON.stringify(spy.pasted))

    /* ⑧ 发送之后：下一条消息从 image-1 重新开号 */
    send()
    paste(clipboardWith([imageFile('image.png', 'image/png')]))
    const lastChip = chips()[chips().length - 1]
    check('发送后新消息重新从 image-1 开始', lastChip?.textContent === 'image-1.png', lastChip?.textContent)

    /* ⑨ 名字跨消息重复时，悬浮预览要落到**那条消息自己的图**上 */
    await driveCrossMessagePreview()

    /* ⑪ 缩略图角标：dock + 已发送气泡的图片行（真 DOM + 真 MutationObserver） */
    await driveThumbnailBadges()

    /* ⑩ 发送前自检：删掉 dock 缩略图后，第一次回车被拦、再按一次放行 */
    send()
    paste(clipboardWith([imageFile('a.png', 'image/png')]))
    const alignedEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    editor.dispatchEvent(alignedEnter)
    check('对得上时回车不拦', alignedEnter.defaultPrevented === false)

    patch({ attachmentIds: [] })
    await sleep(30)
    const notice = spy.notices.filter((item) => item.level === 'info').at(-1)
    check('删掉缩略图后出现自检提示', typeof notice?.text === 'string' && notice.text.startsWith('图片名自检：'), notice?.text)
    check('提示里点出了对不上的名字', typeof notice?.text === 'string' && notice.text.includes('image-1.png'), notice?.text)

    const blockedEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    editor.dispatchEvent(blockedEnter)
    check('自检不通过时第一次回车被拦下', blockedEnter.defaultPrevented === true)
    const allowedEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    editor.dispatchEvent(allowedEnter)
    check('再按一次回车放行（不把用户卡死）', allowedEnter.defaultPrevented === false)

    finish()
  }

  /** 造两条各带一张图 + 同名文字的消息，验证悬浮命中的是各自那条消息里的图。 */
  async function driveCrossMessagePreview() {
    const firstSrc = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    const secondSrc =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const host = document.createElement('div')
    host.id = 'cross-message'
    for (const [key, src, label] of [
      ['k1', firstSrc, '消息一'],
      ['k2', secondSrc, '消息二'],
    ]) {
      const item = document.createElement('div')
      item.setAttribute('data-chat-node-key', key)
      const attachments = document.createElement('div')
      attachments.setAttribute('data-message-attachments', '')
      const image = document.createElement('img')
      image.src = src
      image.width = 8
      image.height = 8
      attachments.append(image)
      const text = document.createElement('div')
      text.textContent = `${label} [image-1.png]`
      item.append(attachments, text)
      host.append(item)
    }
    document.getElementById('transcript').append(host)
    await sleep(30)

    for (const [key, src, label] of [
      ['k1', firstSrc, '第一条消息'],
      ['k2', secondSrc, '第二条消息'],
    ]) {
      const item = host.querySelector(`[data-chat-node-key="${key}"]`)
      const rect = rectOfText(item, 'image-1.png')
      if (rect === null) {
        check(`${label}：找到同名文字`, false)
        continue
      }
      pointerAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
      await sleep(420)
      const shown = card().querySelector('img').src
      check(`${label}：预览的是它自己那张图`, shown === src, shown === src ? '对上了' : `拿到 ${shown.slice(0, 32)}`)
    }
  }

  /** 造一个假 dock 附件轨 + 假消息图片行，验证角标的数字、定位与"不挡点击"。 */
  async function driveThumbnailBadges() {
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    const dock = document.createElement('div')
    dock.setAttribute('data-composer-card', '')
    dock.innerHTML = `<button><img alt="image-1.png" src="${pixel}" width="64" height="64"></button>`
    document.body.append(dock)

    const row = document.createElement('div')
    row.setAttribute('data-message-attachments', '')
    row.innerHTML = `<button><img alt="image-2.png" src="${pixel}" width="64" height="64"></button><button><img alt="photo.png" src="${pixel}" width="64" height="64"></button>`
    document.body.append(row)

    /* 等 MutationObserver + 节流扫描 */
    await sleep(400)

    const dockBadge = dock.querySelector(`[${'data-dsh-inline-paste-badge'}]`)
    check('dock 缩略图出现序号角标', dockBadge !== null && dockBadge.textContent === '1', dockBadge === null ? '没有角标' : dockBadge.textContent)
    if (dockBadge !== null) {
      const style = getComputedStyle(dockBadge)
      check('角标不挡点击（pointer-events:none）', style.pointerEvents === 'none', style.pointerEvents)
      check('角标是绝对定位', style.position === 'absolute', style.position)
    }
    check('缩略图挂上了全名 title', dock.querySelector('img').getAttribute('title') === 'image-1.png', dock.querySelector('img').getAttribute('title'))

    const rowBadges = row.querySelectorAll(`[${'data-dsh-inline-paste-badge'}]`)
    check('气泡图片行按 alt 出角标', rowBadges.length === 1 && rowBadges[0].textContent === '2', `${rowBadges.length} 个 / ${rowBadges[0] === undefined ? '-' : rowBadges[0].textContent}`)
    check('非本插件命名的缩略图不加角标', row.querySelector('img[alt="photo.png"]').parentElement.querySelector(`[${'data-dsh-inline-paste-badge'}]`) === null)

    /* React 重渲染把角标冲掉时，要能自愈 */
    for (const badge of document.querySelectorAll(`[${'data-dsh-inline-paste-badge'}]`)) badge.remove()
    const healed = document.createElement('span')
    healed.id = 'heal-trigger'
    document.body.append(healed)
    await sleep(400)
    check('角标被冲掉后能自愈', dock.querySelector(`[${'data-dsh-inline-paste-badge'}]`) !== null, '重新挂上了')
  }

  function finish() {
    const failed = results.filter((item) => !item.ok)
    output.dataset.status = failed.length === 0 ? 'pass' : 'fail'
    output.innerHTML = results
      .map((item) => `<div class="${item.ok ? 'ok' : 'fail'}">${item.name}${item.detail ? ` — ${item.detail}` : ''}</div>`)
      .join('')
    const payload = { status: failed.length === 0 ? 'pass' : 'fail', passed: results.length - failed.length, total: results.length, results }
    window.__harnessResult = payload
    try {
      fetch('/__result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    } catch (error) {
      /* 服务器不在也无所谓，DOM 里也有结果 */
    }
  }

  run().catch((error) => {
    check('harness 自身不能抛错', false, error && error.message)
    finish()
  })
})()
