/**
 * 单测用的假环境：假 ctx / 假 conversation / 假 shell / 假 paste 事件。
 *
 * 只模拟插件真正用到的那几个面（captureInsertion / insertReference /
 * addAttachments / createDrafts / uiSession.current），不重造 Lexical。
 */

/** 造一个图片 File。 */
export function makeImageFile(name = 'image.png', type = 'image/png', bytes = 16) {
  return new File([new Uint8Array(bytes)], name, { type })
}

/** 造一个非图片 File。 */
export function makeOtherFile(name = 'doc.pdf', type = 'application/pdf', bytes = 16) {
  return new File([new Uint8Array(bytes)], name, { type })
}

/**
 * 造假上下文。
 * @param options - 覆盖项。
 * @returns {ctx, spy, teardowns}
 */
export function makeContext(options = {}) {
  const spy = {
    createdFiles: [],
    inserted: [],
    insertedTexts: [],
    attachments: [],
    released: [],
    pastedTexts: [],
    notices: [],
    effects: 0,
  }
  let draftSeq = 0
  /** 草稿附件登记表：resolveDraftAttachments 要还回带 file.name 的描述符（自检靠它）。 */
  const draftRegistry = new Map()

  const state = {
    phase: options.phase ?? 'plain',
    draft: '',
    attachmentIds: [],
    draftRev: 0,
    /** 草稿里的胶囊（官方面就长这样：{source, label, ...}）。 */
    occurrences: [],
  }

  /** 输入状态的假 store（带 subscribe，自检器会订阅它）。 */
  const stateListeners = new Set()
  const publishState = () => {
    for (const listener of [...stateListeners]) listener()
  }
  const stateStore = {
    getSnapshot: () => ({ ...state, attachmentIds: [...state.attachmentIds], occurrences: [...state.occurrences] }),
    subscribe: (listener) => {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
  }
  /** 输入框上方那条 notice 的假 store（官方就是 shell.notices + shell.notify）。 */
  const notices = {
    value: null,
    getSnapshot: () => notices.value,
    set: (value) => {
      notices.value = value
    },
  }

  const shell = {
    state: stateStore,
    notices,
    notify(level, text) {
      spy.notices.push({ level, text })
      notices.set({ level, text, seq: spy.notices.length })
    },
    actions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: state.draftRev }),
      addAttachments(ids) {
        spy.attachments.push(...ids)
        state.attachmentIds.push(...ids)
        publishState()
        return true
      },
      insertText(text, span) {
        if (options.insertFails === true) return false
        spy.insertedTexts.push({ text, span })
        state.draft += `${text} `
        state.draftRev += 1
        publishState()
        return true
      },
    },
    insertReference(ref, span) {
      if (options.insertFails === true) return false
      spy.inserted.push({ ref, span })
      state.draftRev += 1
      state.draft += `${ref.clipboardText} `
      state.occurrences.push({ source: ref.source, ref: ref.ref, label: ref.label, clipboardText: ref.clipboardText })
      publishState()
      return true
    },
    paste(text) {
      spy.pastedTexts.push(text)
    },
  }

  const conversation = {
    input: {
      for(scope) {
        if (options.noShell === true) throw new Error('no retained session scope')
        return shell
      },
    },
    createDrafts(sessionId, files) {
      spy.createdFiles.push(...files)
      return files.map((file) => {
        const descriptor = { kind: 'image', id: `draft-${++draftSeq}`, file, previewUrl: `blob:mock-${draftSeq}` }
        draftRegistry.set(descriptor.id, descriptor)
        return descriptor
      })
    },
    resolveDraftAttachments(ids) {
      return ids.map((id) => draftRegistry.get(id) ?? { kind: 'image', id })
    },
    releaseDraftAttachments(descriptors) {
      spy.released.push(...descriptors.map((item) => item.id))
    },
  }

  const limits = options.imageLimits ?? undefined
  const services = {
    conversation,
    sessions: {
      list: { getSnapshot: () => ({ ids: [], byId: {} }) },
      scope: () => ({}),
      binding: () =>
        limits === undefined
          ? undefined
          : { session: { projections: { faceOf: (key) => (key === 'imageLimits' ? { getSnapshot: () => limits } : undefined) } } },
    },
    uiSession:
      options.noSession === true
        ? undefined
        : { current: { getSnapshot: () => ({ key: 'session-test', ctx: {} }) } },
  }

  const ctx = {
    get: (name) => services[name],
    effect: (fn) => {
      spy.effects += 1
      const teardown = fn()
      return typeof teardown === 'function' ? teardown : () => {}
    },
  }

  /** 模拟「发送了一条消息」：草稿、附件、胶囊全清空。 */
  const send = () => {
    state.draft = ''
    state.attachmentIds = []
    state.occurrences = []
    state.draftRev += 1
    publishState()
  }

  /** 模拟外部改动（比如用户从 dock 里删掉一张缩略图）。 */
  const patch = (next) => {
    Object.assign(state, next)
    state.draftRev += 1
    publishState()
  }

  return { ctx, spy, shell, state, services, send, patch, publishState, noticesStore: notices }
}

/** 造假 document（只够 isComposerTarget / installPasteInterceptor 用）。 */
export function makeDocument(options = {}) {
  const listeners = []
  const doc = {
    listeners,
    querySelector: (selector) => (options.noMarker === true ? null : selector === '[data-input-scroll]' ? {} : null),
    addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }),
    removeEventListener: (type, handler, capture) => {
      const index = listeners.findIndex((item) => item.type === type && item.handler === handler && item.capture === capture)
      if (index >= 0) listeners.splice(index, 1)
    },
  }
  return doc
}

/**
 * 造假 keydown 事件。
 * @param key - event.key。
 * @param options - shiftKey / altKey / isComposing / inComposer / modifier。
 */
export function makeKeydownEvent(key, options = {}) {
  const event = {
    key,
    keyCode: options.keyCode ?? 0,
    shiftKey: options.shiftKey === true,
    altKey: options.altKey === true,
    isComposing: options.isComposing === true,
    target: makeTarget(options.inComposer !== false),
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      event.defaultPrevented = true
    },
    stopImmediatePropagation() {
      event.stopped = true
    },
    getModifierState: (name) => (options.altGraph === true && name === 'AltGraph' ? true : false),
  }
  return event
}

/** 造假事件目标。 */
export function makeTarget(inComposer = true) {
  return {
    closest: (selector) => (inComposer && (selector === '[data-input-scroll]' || selector === '[contenteditable="true"]') ? {} : null),
  }
}

/**
 * 造假 paste 事件。
 * @param files - 剪贴板里的文件。
 * @param options - text / inComposer / items 覆盖。
 */
export function makePasteEvent(files, options = {}) {
  const items =
    options.items ??
    files.map((file) => ({ kind: 'file', getAsFile: () => file })).concat(options.extraItems ?? [])
  const event = {
    target: makeTarget(options.inComposer !== false),
    clipboardData: {
      items,
      getData: (type) => (type === 'text/plain' ? (options.text ?? '') : ''),
    },
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      event.defaultPrevented = true
    },
    stopImmediatePropagation() {
      event.stopped = true
    },
  }
  return event
}
