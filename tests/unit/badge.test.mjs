/**
 * 缩略图角标：序号从缩略图的 alt 里**读**出来，不是数出来的。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle } from '../helpers/bundle.mjs'

const { mod } = loadBundle()
const { badgeNumberFromAlt, BADGE_ATTRIBUTE } = mod.__test

test('从 alt 解析序号', () => {
  assert.deepEqual({ ...badgeNumberFromAlt('pic-1.png') }, { index: 1, name: 'pic-1.png' })
  assert.deepEqual({ ...badgeNumberFromAlt('pic-12.webp') }, { index: 12, name: 'pic-12.webp' })
  assert.deepEqual({ ...badgeNumberFromAlt('audio-3.mp3') }, { index: 3, name: 'audio-3.mp3' })
  assert.deepEqual({ ...badgeNumberFromAlt(' pic-2.jpg ') }, { index: 2, name: 'pic-2.jpg' })
})

test('不是本插件命名的缩略图不解析', () => {
  assert.equal(badgeNumberFromAlt('photo.png'), undefined)
  assert.equal(badgeNumberFromAlt('image.png'), undefined)
  assert.equal(badgeNumberFromAlt('pic-0.png'), undefined)
  assert.equal(badgeNumberFromAlt('截图 2026-10-02.png'), undefined)
  assert.equal(badgeNumberFromAlt(undefined), undefined)
  assert.equal(badgeNumberFromAlt(''), undefined)
})

test('角标标记属性名固定（清除逻辑靠它）', () => {
  assert.equal(BADGE_ATTRIBUTE, 'data-dsh-inline-paste-badge')
})
