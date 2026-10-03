/**
 * 发送前自检：文字里的图片名字 ↔ 本条消息的图片。
 *
 * 关键契约：官方把名字贴在每张图上发出去（`Image "pic-1.png" (...)`），
 * 所以只要「文字里提到的名字都真有那张图、且不重复」，模型就不会串。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle } from '../helpers/bundle.mjs'
import { makeContext, makeDocument, makeImageFile, makeKeydownEvent, makePasteEvent } from '../helpers/mock.mjs'

const { mod } = loadBundle()
const { auditDraft, auditInputs, createAuditor, installSendGuard, handlePaste, createNameBook, createRegistry, AUDIT_NOTICE_PREFIX, CONFIG } = mod.__test

/** 取出拦截器注册的 keydown 处理器。 */
function keydownHandler(doc) {
  const entry = doc.listeners.find((item) => item.type === 'keydown')
  assert.ok(entry !== undefined, '应当注册了 keydown 监听')
  return entry.handler
}

/** 造一个「自检不通过」的草稿：文字里点了一个不存在的图片名。 */
function misalign(ctx, patch) {
  patch({ occurrences: [{ source: 'inline-paste', label: 'pic-1.png' }], attachmentIds: [], draft: 'pic-1.png ' })
}

test('auditDraft：对得上就通过', () => {
  const verdict = auditDraft(['pic-1.png', 'pic-2.png'], ['pic-1.png', 'pic-2.png'])
  assert.equal(verdict.ok, true)
  assert.equal(verdict.message, undefined)
})

test('auditDraft：文字点了名但消息里没有这张图 → 不通过', () => {
  const verdict = auditDraft(['pic-1.png', 'pic-3.png'], ['pic-1.png', 'pic-2.png'])
  assert.equal(verdict.ok, false)
  assert.deepEqual([...verdict.dangling], ['pic-3.png'])
  assert.match(verdict.message, /pic-3\.png/)
})

test('auditDraft：同一个名字出现两次 → 不通过', () => {
  const verdict = auditDraft(['pic-1.png', 'pic-1.png'], ['pic-1.png', 'pic-1.png'])
  assert.equal(verdict.ok, false)
  assert.deepEqual([...verdict.duplicates], ['pic-1.png'])
})

test('auditDraft：有图但文字没点名 → 不算错（图照样带着名字发出去）', () => {
  const verdict = auditDraft(['pic-1.png'], ['pic-1.png', 'pic-2.png'])
  assert.equal(verdict.ok, true)
})

test('auditDraft：空草稿通过', () => {
  assert.equal(auditDraft([], []).ok, true)
  assert.equal(auditDraft(undefined, undefined).ok, true)
})

test('auditInputs：只取本插件的胶囊 + 附件真实文件名', () => {
  const { ctx } = makeContext()
  const conversation = ctx.get('conversation')
  const drafts = conversation.createDrafts('s1', [makeImageFile('a.png'), makeImageFile('b.png')])
  const state = {
    occurrences: [
      { source: 'reference', label: '@某文件' },
      { source: 'inline-paste', label: 'pic-1.png' },
      { source: 'inline-paste', label: 'pic-2.png' },
    ],
    attachmentIds: drafts.map((draft) => draft.id),
  }
  const inputs = auditInputs(state, conversation)
  assert.deepEqual(inputs.chipLabels, ['pic-1.png', 'pic-2.png'])
  assert.deepEqual(inputs.attachmentNames, ['a.png', 'b.png'])
})

test('实时自检：草稿对不上就在输入框上方挂一条 info 提示', () => {
  const { ctx, spy, patch, noticesStore } = makeContext()
  const auditor = createAuditor(ctx, { debug: {}, report: () => {} })
  auditor.evaluate()
  assert.equal(spy.notices.length, 0, '一开始对得上，不该有提示')

  misalign(ctx, patch)
  const notices = spy.notices.filter((item) => item.level === 'info')
  assert.equal(notices.length, 1, '应当出现一条 info 提示')
  assert.match(notices[0].text, new RegExp(`^${AUDIT_NOTICE_PREFIX}`))
  assert.match(notices[0].text, /pic-1\.png/)
  assert.equal(noticesStore.getSnapshot()?.level, 'info')

  /* 修好之后提示要自己消失 */
  const drafts = ctx.get('conversation').createDrafts('s1', [makeImageFile('pic-1.png')])
  patch({ attachmentIds: drafts.map((draft) => draft.id) })
  assert.equal(spy.notices.filter((item) => item.level === 'info').length, 1, '对上了就不该再挂新提示')
  assert.equal(noticesStore.getSnapshot(), null, '旧提示应当被清掉')
  auditor.dispose()
})

test('拦截：第一次回车被拦下，再按一次放行', () => {
  const { ctx, patch } = makeContext()
  const doc = makeDocument()
  const auditor = createAuditor(ctx, { debug: {}, report: () => {} })
  installSendGuard({ doc, auditor })
  const handler = keydownHandler(doc)

  misalign(ctx, patch)
  const first = makeKeydownEvent('Enter')
  handler(first)
  assert.equal(first.defaultPrevented, true, '第一次应当拦下')
  assert.equal(first.stopped, true)

  const second = makeKeydownEvent('Enter')
  handler(second)
  assert.equal(second.defaultPrevented, false, '再按一次必须放行，不能把用户卡死')
  auditor.dispose()
})

test('拦截：自检通过、Shift+Enter、输入法组合中、不在输入框 → 都不拦', () => {
  const { ctx, patch } = makeContext()
  const doc = makeDocument()
  const auditor = createAuditor(ctx, { debug: {}, report: () => {} })
  installSendGuard({ doc, auditor })
  const handler = keydownHandler(doc)

  misalign(ctx, patch)
  const cases = [
    ['Shift+Enter', makeKeydownEvent('Enter', { shiftKey: true })],
    ['Alt+Enter', makeKeydownEvent('Enter', { altKey: true })],
    ['组合中', makeKeydownEvent('Enter', { isComposing: true })],
    ['keyCode 229', makeKeydownEvent('Enter', { keyCode: 229 })],
    ['输入框外', makeKeydownEvent('Enter', { inComposer: false })],
    ['其它键', makeKeydownEvent('a')],
  ]
  for (const [label, event] of cases) {
    handler(event)
    assert.equal(event.defaultPrevented, false, `${label} 不该被拦`)
  }

  /* 对得上时也不拦 */
  const drafts = ctx.get('conversation').createDrafts('s1', [makeImageFile('pic-1.png')])
  patch({ attachmentIds: drafts.map((draft) => draft.id) })
  const aligned = makeKeydownEvent('Enter')
  handler(aligned)
  assert.equal(aligned.defaultPrevented, false)
  auditor.dispose()
})

test('拦截：关掉开关就只提示不拦', () => {
  const { ctx, patch } = makeContext()
  const doc = makeDocument()
  const auditor = createAuditor(ctx, { debug: {}, report: () => {} })
  installSendGuard({ doc, auditor })
  const handler = keydownHandler(doc)
  misalign(ctx, patch)

  const original = CONFIG.blockOnAuditFailure
  CONFIG.blockOnAuditFailure = false
  try {
    const event = makeKeydownEvent('Enter')
    handler(event)
    assert.equal(event.defaultPrevented, false)
  } finally {
    CONFIG.blockOnAuditFailure = original
  }
  auditor.dispose()
})

test('端到端：粘贴 → 从 dock 删掉缩略图 → 自检不通过（这才是用户会踩的坑）', () => {
  const { ctx, spy, state, patch } = makeContext()
  const doc = makeDocument()
  const auditor = createAuditor(ctx, { debug: {}, report: () => {} })
  const deps = { doc, nameBook: createNameBook(CONFIG), registry: createRegistry(CONFIG), report: () => {}, useChips: true, mine: new Set(), debug: {} }
  assert.equal(handlePaste(ctx, deps, makePasteEvent([makeImageFile('a.png')])), true)
  assert.equal(auditor.evaluate()?.verdict.ok, true, '刚粘完应当是对得上的')

  /* 用户把 dock 里的缩略图删了，但文字里的胶囊还在 */
  patch({ attachmentIds: [] })
  const verdict = auditor.evaluate()?.verdict
  assert.equal(verdict.ok, false)
  assert.deepEqual([...verdict.dangling], ['pic-1.png'])
  assert.equal(spy.notices.filter((item) => item.level === 'info').length, 1)
  assert.equal(state.occurrences.length, 1, '胶囊仍在文字里')
  auditor.dispose()
})
