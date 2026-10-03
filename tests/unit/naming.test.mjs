/**
 * 短名规划：`<prefix>-<n>.<ext>`，前缀按媒体大类、扩展名跟真实 MIME 走。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle } from '../helpers/bundle.mjs'

const { mod } = loadBundle()
const { createNameBook, extensionFor, categoryOf, prefixFor, CONFIG } = mod.__test

test('扩展名优先信 MIME', () => {
  assert.equal(extensionFor('image/png', 'image.png'), 'png')
  assert.equal(extensionFor('image/jpeg', 'whatever'), 'jpg')
  assert.equal(extensionFor('audio/mpeg', 'x'), 'mp3')
  assert.equal(extensionFor('application/pdf', 'x'), 'pdf')
})

test('MIME 缺失/泛化时退回文件名后缀', () => {
  assert.equal(extensionFor('', '报告.PDF'), 'pdf')
  assert.equal(extensionFor('application/octet-stream', 'archive.tar.gz'), 'gz')
  assert.equal(extensionFor('', 'no-extension'), 'bin')
  assert.equal(extensionFor(undefined, undefined), 'bin')
})

test('媒体归类：MIME 优先，其次扩展名', () => {
  assert.equal(categoryOf('image/webp', 'webp'), 'image')
  assert.equal(categoryOf('audio/mpeg', 'mp3'), 'audio')
  assert.equal(categoryOf('video/mp4', 'mp4'), 'video')
  assert.equal(categoryOf('application/pdf', 'pdf'), 'pdf')
  assert.equal(categoryOf('', 'docx'), 'document')
  assert.equal(categoryOf('text/markdown', 'md'), 'text')
  assert.equal(categoryOf('', 'zip'), 'archive')
  assert.equal(categoryOf('', 'heic'), 'image')
  assert.equal(categoryOf('application/octet-stream', 'bin'), 'other')
})

test('前缀表兜底：非法值回落到 file', () => {
  assert.equal(prefixFor(CONFIG, 'image'), 'pic')
  assert.equal(prefixFor({ prefixes: { image: 'bad prefix!' } }, 'image'), 'file')
  assert.equal(prefixFor({ prefixes: {} }, 'audio'), 'file')
})

test('粘贴图片从 pic-1.png 起编号', () => {
  const book = createNameBook(CONFIG)
  assert.equal(book.next('s1', 'image/png', 'image.png').name, 'pic-1.png')
  assert.equal(book.next('s1', 'image/png', 'image.png').name, 'pic-2.png')
  assert.equal(book.next('s1', 'image/webp', 'image.webp').name, 'pic-3.webp')
  assert.equal(book.next('s1', 'image/gif', 'image.gif').name, 'pic-4.gif')
})

test('不同前缀各自计数，会话之间互不干扰', () => {
  const book = createNameBook(CONFIG)
  assert.equal(book.next('s1', 'image/png', 'a.png').name, 'pic-1.png')
  assert.equal(book.next('s1', 'audio/mpeg', 'a.mp3').name, 'audio-1.mp3')
  assert.equal(book.next('s1', 'audio/mpeg', 'a.mp3').name, 'audio-2.mp3')
  assert.equal(book.next('s2', 'image/png', 'a.png').name, 'pic-1.png')
  assert.equal(book.next('s1', 'image/png', 'a.png').name, 'pic-2.png')
})

test('未来类型：pdf / doc / text / zip / 兜底', () => {
  const book = createNameBook(CONFIG)
  assert.equal(book.next('s', 'application/pdf', 'x.pdf').name, 'pdf-1.pdf')
  assert.equal(book.next('s', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x.docx').name, 'doc-1.docx')
  assert.equal(book.next('s', 'text/markdown', 'x.md').name, 'text-1.md')
  assert.equal(book.next('s', 'application/zip', 'x.zip').name, 'zip-1.zip')
  assert.equal(book.next('s', 'application/octet-stream', 'x.bin').name, 'file-1.bin')
  assert.equal(book.next('s', 'audio/wav', 'x.wav').name, 'audio-1.wav')
  assert.equal(book.next('s', 'video/quicktime', 'x.mov').name, 'video-1.mov')
})

test('startIndex 可配置（0 起 → pic-0.png）', () => {
  const book = createNameBook({ ...CONFIG, startIndex: 0 })
  assert.equal(book.next('s', 'image/png', 'a.png').name, 'pic-0.png')
  assert.equal(book.next('s', 'image/png', 'a.png').name, 'pic-1.png')
})

test('forget 只清指定会话', () => {
  const book = createNameBook(CONFIG)
  book.next('s1', 'image/png', 'a.png')
  book.next('s2', 'image/png', 'a.png')
  book.forget('s1')
  assert.equal(book.next('s1', 'image/png', 'a.png').name, 'pic-1.png')
  assert.equal(book.next('s2', 'image/png', 'a.png').name, 'pic-2.png')
})

/* ---- 计数器持久化（刷新页面后同一个会话接着排，换会话重新开） ---- */

/** 假 localStorage。 */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    dump: () => Object.fromEntries(map),
  }
}

test('同一会话刷新页面后接着编号（持久化生效）', () => {
  const storage = fakeStorage()
  const first = createNameBook(CONFIG, storage)
  assert.equal(first.next('s1', 'image/png', 'a.png').name, 'pic-1.png')
  assert.equal(first.next('s1', 'image/png', 'a.png').name, 'pic-2.png')

  /* 模拟刷新页面：新的 nameBook 实例、同一份 storage */
  const afterReload = createNameBook(CONFIG, fakeStorage(storage.dump()))
  assert.equal(afterReload.next('s1', 'image/png', 'a.png').name, 'pic-3.png')
  assert.equal(afterReload.next('s1', 'image/png', 'a.png').name, 'pic-4.png')
})

test('新会话从 pic-1 重新开号（即使有其它会话的历史计数）', () => {
  const storage = fakeStorage()
  const book = createNameBook(CONFIG, storage)
  book.next('s1', 'image/png', 'a.png')
  book.next('s1', 'image/png', 'a.png')
  book.next('s1', 'image/png', 'a.png')
  assert.equal(book.next('s2', 'image/png', 'a.png').name, 'pic-1.png')

  const afterReload = createNameBook(CONFIG, fakeStorage(storage.dump()))
  assert.equal(afterReload.next('s2', 'image/png', 'a.png').name, 'pic-2.png')
  assert.equal(afterReload.next('s1', 'image/png', 'a.png').name, 'pic-4.png')
})

test('没有 storage 时退化为内存计数（不抛错）', () => {
  const book = createNameBook(CONFIG, undefined)
  assert.equal(book.next('s1', 'image/png', 'a.png').name, 'pic-1.png')
})

test('storage 读写抛错也照样计数', () => {
  const broken = {
    getItem() {
      throw new Error('boom')
    },
    setItem() {
      throw new Error('boom')
    },
  }
  const book = createNameBook(CONFIG, broken)
  assert.equal(book.next('s1', 'image/png', 'a.png').name, 'pic-1.png')
  assert.equal(book.next('s1', 'image/png', 'a.png').name, 'pic-2.png')
})

test('forget 清掉会话计数并落盘', () => {
  const storage = fakeStorage()
  const book = createNameBook(CONFIG, storage)
  book.next('s1', 'image/png', 'a.png')
  book.forget('s1')
  assert.equal(book.next('s1', 'image/png', 'a.png').name, 'pic-1.png')
  const saved = JSON.parse(storage.dump()['dsh-inline-pastes:v2:counters'])
  assert.equal(saved.sessions.s1.prefixes.pic, 2)
})

/* ---- 编号范围：默认「每条消息从 1 重开」 ---- */

test('每条消息都从 pic-1 重开（reset 由调用方给）', () => {
  const book = createNameBook(CONFIG)
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: true }).name, 'pic-1.png')
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: false }).name, 'pic-2.png')
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: false }).name, 'pic-3.png')
  /* 发送完下一条消息重新开 */
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: true }).name, 'pic-1.png')
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: false }).name, 'pic-2.png')
})

test('重开只影响本次消息，别的会话不受影响', () => {
  const book = createNameBook(CONFIG)
  book.next('s1', 'image/png', 'a.png', { reset: true })
  book.next('s1', 'image/png', 'a.png', { reset: false })
  assert.equal(book.next('s2', 'image/png', 'a.png', { reset: true }).name, 'pic-1.png')
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: false }).name, 'pic-3.png')
})

test("counterScope='session' 时忽略 reset，整个会话连续排", () => {
  const book = createNameBook({ ...CONFIG, counterScope: 'session' })
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: true }).name, 'pic-1.png')
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: true }).name, 'pic-2.png')
  assert.equal(book.next('s1', 'image/png', 'a.png', { reset: false }).name, 'pic-3.png')
})

test('按消息重开时，未发送的那条消息在刷新页面后仍接着排', () => {
  const storage = fakeStorage()
  const before = createNameBook(CONFIG, storage)
  before.next('s1', 'image/png', 'a.png', { reset: true })
  before.next('s1', 'image/png', 'a.png', { reset: false })

  /* 刷新页面：草稿里还留着胶囊 → 调用方传 reset:false → 接着排 */
  const afterReload = createNameBook(CONFIG, fakeStorage(storage.dump()))
  assert.equal(afterReload.next('s1', 'image/png', 'a.png', { reset: false }).name, 'pic-3.png')
  /* 而发送之后的空草稿 → reset:true → 从 1 重开 */
  assert.equal(afterReload.next('s1', 'image/png', 'a.png', { reset: true }).name, 'pic-1.png')
})
