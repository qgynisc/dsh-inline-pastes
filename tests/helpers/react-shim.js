/**
 * 极小的 React 替身（Node 单测与浏览器 harness 共用）。
 *
 * 真机上是 DSH 模块加载器提供的那份真 React；这里只覆盖设置页用到的几个 API，
 * 把组件渲染成一棵**普通对象树**，好让测试直接断言「面板里出现了什么文字、什么类名」。
 *
 * 刻意保持"诚实的小"：只实现 createElement / useState / useEffect / useRef / Fragment。
 * 它不是 React 的替代品，也**不**验证 React 的行为 —— 真 React 下的表现由真机验证负责。
 */

/**
 * 造一个 React 替身。
 * @returns react 对象（额外挂 __internals 供 render 用）。
 */
export function createReact() {
  const internals = { cells: [], cursor: 0, effects: [], mounted: false, cleanups: [] }
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const flat = children.length <= 1 ? children[0] : children
      return { type, props: { ...(props ?? {}), children: flat }, children: flat }
    },
    useState(initial) {
      const index = internals.cursor
      internals.cursor += 1
      /* 首轮渲染才落初值；之后的渲染沿用上一次的格子（模拟 React 的 state 保持） */
      if (internals.cells.length <= index) internals.cells[index] = typeof initial === 'function' ? initial() : initial
      const set = (value) => {
        internals.cells[index] = typeof value === 'function' ? value(internals.cells[index]) : value
      }
      return [internals.cells[index], set]
    },
    useEffect(effect) {
      internals.effects.push(effect)
    },
    useRef(value) {
      const index = internals.cursor
      internals.cursor += 1
      if (internals.cells.length <= index) internals.cells[index] = { current: value }
      return internals.cells[index]
    },
    __internals: internals,
  }
  return react
}

/**
 * 渲染一次组件（函数组件直接调用，返回元素树）。
 * 首次渲染后跑一遍 useEffect —— 与 React 的 `deps: []` 行为一致，后续渲染不再重跑。
 * @param react - createReact() 的结果。
 * @param Component - 函数组件。
 * @param props - 传给组件的属性。
 * @returns 元素树。
 */
export function render(react, Component, props = {}) {
  const internals = react.__internals
  internals.cursor = 0
  internals.effects = []
  const tree = expand(react, Component(props))
  if (!internals.mounted) {
    internals.mounted = true
    for (const effect of internals.effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') internals.cleanups.push(cleanup)
    }
  }
  return tree
}

/**
 * 把元素树里的**函数组件**就地展开成宿主节点树（够用的迷你渲染器）。
 * 这样 `render(react, 外层组件)` 出来的树里不会残留没被调用的嵌套组件。
 */
function expand(react, node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((child) => expand(react, child))
  if (typeof node.type === 'function') {
    const internals = react.__internals
    const outerCursor = internals.cursor
    internals.cursor = 0
    const rendered = node.type(node.props)
    internals.cursor = outerCursor
    return expand(react, rendered)
  }
  return { ...node, children: expand(react, node.children) }
}

/** 元素树里所有文字拼起来（断言文案用）。 */
export function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => textOf(child)).join('')
  return textOf(node.children)
}

/** 深度优先找所有满足条件的元素。 */
export function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (typeof node.type !== 'undefined' && predicate(node)) out.push(node)
  findAll(node.children, predicate, out)
  return out
}

/** 按 className（空格分隔，含即算）找元素。 */
export function findByClass(node, className) {
  return findAll(node, (element) => typeof element.props?.className === 'string' && element.props.className.split(/\s+/).includes(className))
}

/** 找所有指定标签的元素（'select' / 'input' / 'a' …）。 */
export function findByTag(node, tag) {
  return findAll(node, (element) => element.type === tag)
}
