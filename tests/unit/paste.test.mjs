/**
 * 粘贴接管：该管的时候管、不该管的时候**必须不比官方多拦一步**。
 *
 * 上一代同类插件的教训就是「无脑 preventDefault + stopImmediatePropagation」，
 * 读不到会话后既没插成胶囊、又把官方图片粘贴堵死。这里逐条钉住兜底行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle } from '../helpers/bundle.mjs'
import { makeContext, makeDocument, makeImageFile, makeOtherFile, makePasteEvent } from '../helpers/mock.mjs'

const { mod } = loadBundle()
const { handlePaste, installPasteInterceptor, createNameBook, createRegistry, CONFIG } = mod.__test

/** 组装一次 handlePaste 调用。 */
function run(ctx, event, options = {}) {
  const deps = {
    doc: options.doc ?? makeDocument(),
    nameBook: createNameBook(CONFIG),
    registry: createRegistry(CONFIG),
    report: () => {},
  }
  if (options.nameBook !== undefined) deps.nameBook = options.nameBook
  deps.useChips = options.useChips !== false
  return { consumed: handlePaste(ctx, deps, event), deps }
}

test('粘贴图片：光标处插胶囊 + 挂草稿附件 + 登记预览', () => {
  const { ctx, spy } = makeContext()
  const event = makePasteEvent([makeImageFile('image.png', 'image/png')])
  const { consumed, deps } = run(ctx, event)

  assert.equal(consumed, true)
  assert.equal(spy.inserted.length, 1)
  const [insert] = spy.inserted
  assert.equal(insert.ref.source, 'inline-paste')
  assert.equal(insert.ref.label, 'pic-1')
  assert.equal(insert.ref.clipboardText, 'pic-1.png')
  assert.equal(insert.ref.appearance, 'file')
  assert.equal(insert.ref.ref, 'dsh-inline-paste:pic-1.png')
  assert.deepEqual(spy.attachments, ['draft-1'])
  assert.equal(spy.createdFiles[0].name, 'pic-1.png')
  assert.equal(deps.registry.has('pic-1.png'), true)
  assert.equal(deps.registry.get('pic-1.png').url.startsWith('blob:'), true)
  assert.equal(deps.registry.get('pic-1.png').bytes, 16)
})

test('连续粘贴自动编号 pic-1 / pic-2', () => {
  const { ctx, spy } = makeContext()
  const book = createNameBook(CONFIG)
  const registry = createRegistry(CONFIG)
  const doc = makeDocument()
  run(ctx, makePasteEvent([makeImageFile('image.png')]), { nameBook: book, registry, doc })
  run(ctx, makePasteEvent([makeImageFile('image.png')]), { nameBook: book, registry, doc })
  assert.deepEqual(
    spy.inserted.map((item) => item.ref.label),
    ['pic-1', 'pic-2'],
  )
  assert.deepEqual(spy.attachments, ['draft-1', 'draft-2'])
})

test('WebP 走真实扩展名', () => {
  const { ctx, spy } = makeContext()
  run(ctx, makePasteEvent([makeImageFile('image.webp', 'image/webp')]))
  assert.equal(spy.inserted[0].ref.label, 'pic-1')
  assert.equal(spy.createdFiles[0].name, 'pic-1.webp')
})

test('一次粘贴多张图：全部插胶囊、按序挂附件', () => {
  const { ctx, spy } = makeContext()
  const files = [makeImageFile('a.png'), makeImageFile('b.png'), makeImageFile('c.png')]
  const { consumed } = run(ctx, makePasteEvent(files))
  assert.equal(consumed, true)
  assert.deepEqual(
    spy.inserted.map((item) => item.ref.label),
    ['pic-1', 'pic-2', 'pic-3'],
  )
  assert.deepEqual(spy.attachments, ['draft-1', 'draft-2', 'draft-3'])
})

test('剪贴板里混有非图片文件 → 整批交还官方（不接管）', () => {
  const { ctx, spy } = makeContext()
  const { consumed } = run(ctx, makePasteEvent([makeImageFile(), makeOtherFile()]))
  assert.equal(consumed, false)
  assert.equal(spy.inserted.length, 0)
  assert.equal(spy.createdFiles.length, 0)
})

test('不受支持的图片类型（image/bmp）→ 不接管', () => {
  const { ctx, spy } = makeContext()
  const { consumed } = run(ctx, makePasteEvent([makeImageFile('a.bmp', 'image/bmp')]))
  assert.equal(consumed, false)
  assert.equal(spy.inserted.length, 0)
})

test('输入框正在提交/裁决 → 不接管', () => {
  for (const phase of ['submitting', 'adjudicating']) {
    const { ctx, spy } = makeContext({ phase })
    const { consumed } = run(ctx, makePasteEvent([makeImageFile()]))
    assert.equal(consumed, false, `phase=${phase} 不应接管`)
    assert.equal(spy.inserted.length, 0)
  }
})

test('没打开会话 → 不接管且不拦事件', () => {
  const { ctx, spy } = makeContext({ noSession: true })
  const event = makePasteEvent([makeImageFile()])
  const { consumed } = run(ctx, event)
  assert.equal(consumed, false)
  assert.equal(spy.inserted.length, 0)
  assert.equal(event.defaultPrevented, false)
})

test('胶囊插不进去 → 释放草稿、不接管（把粘贴还给官方）', () => {
  const { ctx, spy } = makeContext({ insertFails: true })
  const { consumed } = run(ctx, makePasteEvent([makeImageFile()]))
  assert.equal(consumed, false)
  assert.deepEqual(spy.released, ['draft-1'])
  assert.equal(spy.attachments.length, 0)
})

test('超出会话图片限额 → 不接管（让官方自己弹提示）', () => {
  const { ctx, spy } = makeContext({ imageLimits: { mediaTypes: ['image/png'], maxImagesPerMessage: 1, maxImageBytes: 1024, maxMessageImageBytes: 4096 } })
  const { consumed } = run(ctx, makePasteEvent([makeImageFile('a.png'), makeImageFile('b.png')]))
  assert.equal(consumed, false)
  assert.equal(spy.inserted.length, 0)
})

test('限额内正常接管', () => {
  const { ctx, spy } = makeContext({ imageLimits: { mediaTypes: ['image/png'], maxImagesPerMessage: 4, maxImageBytes: 1024, maxMessageImageBytes: 4096 } })
  const { consumed } = run(ctx, makePasteEvent([makeImageFile()]))
  assert.equal(consumed, true)
  assert.equal(spy.inserted.length, 1)
})

test('剪贴板同时带文字 → 图片插完后按官方顺序补文字', () => {
  const { ctx, spy } = makeContext()
  const { consumed } = run(ctx, makePasteEvent([makeImageFile()], { text: '1、功能1 ' }))
  assert.equal(consumed, true)
  assert.deepEqual(spy.pastedTexts, ['1、功能1 '])
})

test('事件发生在输入框外 → 不接管', () => {
  const { ctx } = makeContext()
  const { consumed } = run(ctx, makePasteEvent([makeImageFile()], { inComposer: false }))
  assert.equal(consumed, false)
})

test('拦截器：接管才 preventDefault + stopImmediatePropagation', () => {
  const { ctx } = makeContext()
  const doc = makeDocument()
  const off = installPasteInterceptor(ctx, {
    doc,
    nameBook: createNameBook(CONFIG),
    registry: createRegistry(CONFIG),
    report: () => {},
  })
  assert.equal(doc.listeners.length, 1)
  assert.equal(doc.listeners[0].type, 'paste')
  assert.equal(doc.listeners[0].capture, true)

  const taken = makePasteEvent([makeImageFile()])
  doc.listeners[0].handler(taken)
  assert.equal(taken.defaultPrevented, true)
  assert.equal(taken.stopped, true)

  const passed = makePasteEvent([makeOtherFile()])
  doc.listeners[0].handler(passed)
  assert.equal(passed.defaultPrevented, false)
  assert.equal(passed.stopped, false)

  off()
  assert.equal(doc.listeners.length, 0)
})

test('拦截器：处理器内部抛错也必须放行', () => {
  const doc = makeDocument()
  const brokenCtx = {
    get(name) {
      if (name === 'uiSession') return { current: { getSnapshot: () => ({ key: 'session-x', ctx: {} }) } }
      if (name === 'conversation') {
        return {
          input: {
            for() {
              return {
                state: {
                  getSnapshot() {
                    throw new Error('boom')
                  },
                },
                actions: { captureInsertion: () => ({}), addAttachments: () => {} },
                insertReference: () => true,
              }
            },
          },
          createDrafts: () => [],
        }
      }
      return undefined
    },
  }
  installPasteInterceptor(brokenCtx, { doc, nameBook: createNameBook(CONFIG), registry: createRegistry(CONFIG), report: () => {} })
  const event = makePasteEvent([makeImageFile()])
  doc.listeners[0].handler(event)
  assert.equal(event.defaultPrevented, false)
  assert.equal(event.stopped, false)
})

/* ---- 会话解析：认不出「主视图正在显示哪个会话」时绝不猜 ---- */

/** 造一个「uiSession 不可用」的 ctx，只给 sessions.list 快照。 */
function listOnlyCtx(list) {
  return {
    get(name) {
      if (name === 'sessions') return { list: { getSnapshot: () => list }, scope: () => ({}) }
      if (name === 'conversation') {
        return {
          input: { for: () => ({ state: { getSnapshot: () => ({ phase: 'plain', attachmentIds: [] }) }, actions: {} }) },
          createDrafts: () => [],
        }
      }
      return undefined
    },
  }
}

test('uiSession 不可用时：能认主视图会话就解析出来', () => {
  const { resolveSession } = mod.__test
  const ctx = listOnlyCtx({
    ids: ['session-a', 'session-b'],
    byId: { 'session-a': { retainedBy: {} }, 'session-b': { retainedBy: { mainView: 1 } } },
  })
  assert.equal(resolveSession(ctx).sessionId, 'session-b')
})

test('uiSession 不可用且认不出主视图会话时：不解析（绝不猜 ids[0]）', () => {
  const { resolveSession } = mod.__test
  const ctx = listOnlyCtx({
    ids: ['session-a', 'session-b'],
    byId: { 'session-a': { retainedBy: {} }, 'session-b': { retainedBy: {} } },
  })
  assert.equal(resolveSession(ctx), undefined)
})

test('认不出会话时粘贴原样放行（不接管、不 preventDefault）', () => {
  const ctx = listOnlyCtx({
    ids: ['session-a'],
    byId: { 'session-a': { retainedBy: {} } },
  })
  const event = makePasteEvent([makeImageFile()])
  const { consumed } = run(ctx, event)
  assert.equal(consumed, false)
  assert.equal(event.defaultPrevented, false)
})

/* ---- 每条消息从 pic-1 重开 ---- */

test('同一消息内连续粘贴：pic-1 → pic-2', () => {
  const { ctx, spy } = makeContext()
  const book = createNameBook(CONFIG)
  const registry = createRegistry(CONFIG)
  const doc = makeDocument()
  run(ctx, makePasteEvent([makeImageFile('a.png')]), { nameBook: book, registry, doc })
  run(ctx, makePasteEvent([makeImageFile('b.png')]), { nameBook: book, registry, doc })
  assert.deepEqual(
    spy.inserted.map((item) => item.ref.label),
    ['pic-1', 'pic-2'],
  )
})

test('发送之后再粘：从 pic-1 重新开号', () => {
  const { ctx, spy, send } = makeContext()
  const book = createNameBook(CONFIG)
  const registry = createRegistry(CONFIG)
  const doc = makeDocument()
  run(ctx, makePasteEvent([makeImageFile('a.png')]), { nameBook: book, registry, doc })
  run(ctx, makePasteEvent([makeImageFile('b.png')]), { nameBook: book, registry, doc })
  send()
  run(ctx, makePasteEvent([makeImageFile('c.png')]), { nameBook: book, registry, doc })
  assert.deepEqual(
    spy.inserted.map((item) => item.ref.label),
    ['pic-1', 'pic-2', 'pic-1'],
  )
})

test('先打字再插第一张图，也算新消息（从 pic-1 开始）', () => {
  const { ctx, spy, state } = makeContext()
  state.draft = '1、功能1 '
  const book = createNameBook(CONFIG)
  const registry = createRegistry(CONFIG)
  const doc = makeDocument()
  run(ctx, makePasteEvent([makeImageFile('a.png')]), { nameBook: book, registry, doc })
  run(ctx, makePasteEvent([makeImageFile('b.png')]), { nameBook: book, registry, doc })
  assert.deepEqual(
    spy.inserted.map((item) => item.ref.label),
    ['pic-1', 'pic-2'],
  )
})

test('一次粘多张时只有第一张重开，其余接着排', () => {
  const { ctx, spy, send } = makeContext()
  const book = createNameBook(CONFIG)
  const registry = createRegistry(CONFIG)
  const doc = makeDocument()
  run(ctx, makePasteEvent([makeImageFile('a.png'), makeImageFile('b.png')]), { nameBook: book, registry, doc })
  send()
  run(ctx, makePasteEvent([makeImageFile('c.png'), makeImageFile('d.png')]), { nameBook: book, registry, doc })
  assert.deepEqual(
    spy.inserted.map((item) => item.ref.label),
    ['pic-1', 'pic-2', 'pic-1', 'pic-2'],
  )
})

test('startsNewMessage：草稿里有本插件的胶囊就不是新消息', () => {
  const { startsNewMessage } = mod.__test
  assert.equal(startsNewMessage({ occurrences: [] }), true)
  assert.equal(startsNewMessage({ occurrences: [{ source: 'reference' }] }), true)
  assert.equal(startsNewMessage({ occurrences: [{ source: 'inline-paste', label: 'pic-1.png' }] }), false)
  /* 快照没有 occurrences 时退化为「草稿与附件都空」 */
  assert.equal(startsNewMessage({ draft: '1、功能1 ' }), false)
  assert.equal(startsNewMessage({ draft: '' }), true)
})

/* ---- 发送时的引用序列化（官方契约，v0.3.0 踩过的坑） ---- */

test('nameFromRef 从隐藏 ref 还原出模型侧的名字', () => {
  const { nameFromRef } = mod.__test
  assert.equal(nameFromRef('dsh-inline-paste:pic-1.png'), 'pic-1.png')
  assert.equal(nameFromRef('pic-2.webp'), 'pic-2.webp')
  assert.equal(nameFromRef(undefined), '')
})

test('拿不到 inputTriggers 时退回纯文本插入，而不是插一个发送必炸的胶囊', () => {
  const { ctx, spy } = makeContext()
  const { consumed } = run(ctx, makePasteEvent([makeImageFile('a.png')]), { useChips: false })
  assert.equal(consumed, true)
  assert.equal(spy.inserted.length, 0, '不应插入胶囊')
  assert.deepEqual(
    spy.insertedTexts.map((item) => item.text),
    ['pic-1.png'],
  )
  assert.deepEqual(spy.attachments, ['draft-1'])
})

/* ---- 胶囊被删掉但附件还留着：不能再从 pic-1 重开（否则一条消息俩 pic-1） ---- */

test('删掉胶囊但保留 dock 缩略图时，编号接着排（不重开）', () => {
  const { ctx, spy, state, send } = makeContext()
  const book = createNameBook(CONFIG)
  const registry = createRegistry(CONFIG)
  const doc = makeDocument()
  const mine = new Set()
  const runWithMine = (event) =>
    handlePaste(
      ctx,
      { doc, nameBook: book, registry, report: () => {}, useChips: true, mine },
      event,
    )

  assert.equal(runWithMine(makePasteEvent([makeImageFile('a.png')])), true)
  /* 用户把文字里的胶囊删了，但没动 dock 里的缩略图 */
  state.occurrences = []
  state.draft = ''
  assert.equal(runWithMine(makePasteEvent([makeImageFile('b.png')])), true)
  assert.deepEqual(
    spy.inserted.map((item) => item.ref.label),
    ['pic-1', 'pic-2'],
  )

  /* 真发送之后（附件也清空）才重新开号 */
  send()
  assert.equal(runWithMine(makePasteEvent([makeImageFile('c.png')])), true)
  assert.equal(spy.inserted[2].ref.label, 'pic-1')
})
