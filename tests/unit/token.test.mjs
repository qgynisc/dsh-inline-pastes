/**
 * 名字定位：给定文本节点 + 光标偏移，判断悬停在哪个名字上。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle } from '../helpers/bundle.mjs'

const { mod } = loadBundle()
const { tokenAt, lookupName, describe, formatBytes } = mod.__test

/** 假名字表。 */
function table(...names) {
  const set = new Set(names)
  return { has: (name) => set.has(name) }
}

test('tokenAt 在字符上展开出整段 token', () => {
  const text = '见 image-1.png 收工'
  const found = tokenAt(text, text.indexOf('1.png'))
  assert.equal(found.token, 'image-1.png')
  assert.equal(text.slice(found.start, found.end), 'image-1.png')
})

test('tokenAt 落在 token 右边界也能命中', () => {
  const text = '见 image-1.png 收工'
  const end = text.indexOf('image-1.png') + 'image-1.png'.length
  assert.equal(tokenAt(text, end).token, 'image-1.png')
})

test('tokenAt 不在 token 上返回 null', () => {
  assert.equal(tokenAt('收工', 0), null)
  assert.equal(tokenAt('', 0), null)
})

test('lookupName 命中已知名字', () => {
  const text = '1、功能1 image-1.png'
  const found = lookupName(table('image-1.png'), text, text.indexOf('image-1.png') + 3)
  assert.deepEqual({ ...found }, { token: 'image-1.png', start: text.indexOf('image-1.png'), end: text.length })
})

test('lookupName 去掉句末句点', () => {
  const text = '见 image-1.png.'
  const found = lookupName(table('image-1.png'), text, text.indexOf('1.png'))
  assert.equal(found.token, 'image-1.png')
  assert.equal(text.slice(found.start, found.end), 'image-1.png')
})

test('lookupName 处理左边紧贴数字的写法（功能1image-1.png）', () => {
  const text = '功能1image-1.png，把它变成可自动定位。'
  const found = lookupName(table('image-1.png'), text, text.indexOf('image-1.png') + 2)
  assert.equal(found.token, 'image-1.png')
  assert.equal(text.slice(found.start, found.end), 'image-1.png')
})

test('lookupName 处理中文紧贴（见图image-1.png）', () => {
  const text = '见图image-1.png，收工'
  const found = lookupName(table('image-1.png'), text, text.indexOf('png'))
  assert.equal(found.token, 'image-1.png')
})

test('lookupName 没登记的名字不命中', () => {
  const text = '见 image-9.png'
  assert.equal(lookupName(table('image-1.png'), text, text.indexOf('1.png')), null)
})

test('lookupName 不会匹配到窗口外远处的同名文字', () => {
  const text = `image-1.png${'铺'.repeat(200)}`
  assert.equal(lookupName(table('image-1.png'), text, 150), null)
})

test('体积格式化', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(20480), '20 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
  assert.equal(formatBytes(0), '')
})

test('说明行：尺寸 + 体积', () => {
  assert.equal(describe({ width: 1200, height: 800, bytes: 2048 }), '1200×800 · 2.0 KB')
  assert.equal(describe({ bytes: 2048 }), '2.0 KB')
})
