/**
 * 把 tests/helpers/react-shim.js 渲染出来的元素树变成真 DOM（只给预览页用）。
 *
 * 这是个**迷你渲染器**，不是 React：只处理设置页用到的那几种 props
 * （className / style / value / checked / onClick / onChange / href 等）。
 */
export function toDom(node, doc) {
  if (node === null || node === undefined || typeof node === 'boolean') return doc.createTextNode('')
  if (typeof node === 'string' || typeof node === 'number') return doc.createTextNode(String(node))
  if (Array.isArray(node)) {
    const fragment = doc.createDocumentFragment()
    for (const child of node) fragment.append(toDom(child, doc))
    return fragment
  }
  const element = doc.createElement(node.type)
  let value
  for (const [key, prop] of Object.entries(node.props ?? {})) {
    if (key === 'children' || key === 'key') continue
    if (key === 'className') element.setAttribute('class', prop)
    else if (key === 'style' && typeof prop === 'object') Object.assign(element.style, prop)
    else if (key === 'value') value = prop
    else if (key === 'checked') element.checked = prop === true
    else if (key === 'spellCheck') element.spellcheck = prop === true
    else if (key.startsWith('on') && typeof prop === 'function') element.addEventListener(key.slice(2).toLowerCase(), prop)
    else if (prop === true) element.setAttribute(key, '')
    else if (prop !== false && prop !== null && prop !== undefined) element.setAttribute(key, prop)
  }
  element.append(toDom(node.children, doc))
  /* select 的选中值必须在 options 插进去之后设，否则不生效 */
  if (value !== undefined && typeof element.value === 'string') element.value = value
  return element
}
