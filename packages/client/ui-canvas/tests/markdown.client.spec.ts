import { describe, expect, it } from 'vitest'
import { mdToHtml } from '../src/client/CanvasPanel.tsx'

describe('mdToHtml tables', () => {
  it('renders a pipe table with header, separator, and body rows', () => {
    const src = [
      '| 设备 | 次数 |',
      '| --- | --- |',
      '| 1号机 | 3 |',
      '| 2号机 | 5 |',
      '',
    ].join('\n')
    expect(mdToHtml(src)).toBe(
      '<table><thead><tr><th>设备</th><th>次数</th></tr></thead>'
      + '<tbody><tr><td>1号机</td><td>3</td></tr><tr><td>2号机</td><td>5</td></tr></tbody></table>',
    )
  })

  it('applies inline rules and escapes HTML inside cells', () => {
    const src = [
      '| 列 |',
      '| --- |',
      '| **bold** and `code` |',
      '| <script>alert(1)</script> |',
      '',
    ].join('\n')
    expect(mdToHtml(src)).toBe(
      '<table><thead><tr><th>列</th></tr></thead>'
      + '<tbody>'
      + '<tr><td><strong>bold</strong> and <code>code</code></td></tr>'
      + '<tr><td>&lt;script&gt;alert(1)&lt;/script&gt;</td></tr>'
      + '</tbody></table>',
    )
  })

  it('does not treat a pipe-led block without a separator row as a table', () => {
    const src = [
      '| 不是表格',
      '| 只是竖线开头的文本',
      '',
    ].join('\n')
    expect(mdToHtml(src)).toBe('<p>| 不是表格 | 只是竖线开头的文本</p>')
  })

  it('does not emit a table for a separator-only block', () => {
    expect(mdToHtml('| --- |\n')).toBe('<p>| --- |</p>')
  })

  it('closes paragraph and list state around a table', () => {
    const src = [
      '前文段落。',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '- 后续列表',
      '',
    ].join('\n')
    expect(mdToHtml(src)).toBe(
      '<p>前文段落。</p>\n'
      + '<table><thead><tr><th>a</th><th>b</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>\n'
      + '<ul>\n<li>后续列表</li>\n</ul>',
    )
  })
})

describe('mdToHtml existing block behavior', () => {
  it('renders headings, code fences, quotes, and rules', () => {
    const src = [
      '## 标题',
      '',
      '> 引用',
      '',
      '---',
      '',
      '```',
      'const x = 1',
      '```',
      '',
    ].join('\n')
    expect(mdToHtml(src)).toBe(
      '<h2>标题</h2>\n'
      + '<blockquote>引用</blockquote>\n'
      + '<hr/>\n'
      + '<pre><code>const x = 1</code></pre>',
    )
  })

  it('renders ordered and unordered lists', () => {
    expect(mdToHtml('- a\n- b\n')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
    expect(mdToHtml('1. a\n2. b\n')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>')
  })
})
