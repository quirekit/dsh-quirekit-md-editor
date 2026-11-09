/** Benchmark documents: mixed Chinese and English Markdown of a fixed length. */

/** Structure-heavy notes: a table, code block or callout every few hundred characters. */
const DENSE_SECTION = `## 发布记录

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。Ordinary English sentences sit beside it, so the document reads like real project notes.

- [x] 已完成的任务
- [ ] 待办事项
  - 嵌套列表项

> 引用内容也是文档里常见的结构。

| 模块 | 状态 | 负责人 |
| --- | --- | --- |
| 编辑器 | 进行中 | Ada |
| 导出 | 已完成 | Lin |

\`\`\`ts
export function add(left: number, right: number): number {
  return left + right
}
\`\`\`

::: note 说明
提示块里的内容。
:::

`;

/** Long-form writing: mostly paragraphs, with structure every few thousand characters. */
const PROSE_SECTION = `## 章节

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 这一段是普通正文，包含**粗体**、*斜体*、\`行内代码\`和[链接](https://example.org)。长文档里大部分内容都是这样的段落，段落之间穿插少量结构。Ordinary English sentences sit beside the Chinese text, so the document reads like real project notes, reports and long-form writing. 

- [x] 已完成的任务
- [ ] 待办事项

| 模块 | 状态 |
| --- | --- |
| 编辑器 | 进行中 |

\`\`\`ts
const value = 12
\`\`\`

`;

/** Document shapes the benchmark measures. */
export const PROFILES = { prose: PROSE_SECTION, dense: DENSE_SECTION };

const MARKER = '在这里输入。';

/**
 * @param {number} characters - exact document length.
 * @param {keyof typeof PROFILES} profile - document shape.
 * @returns {{ source: string, position: number }} the document and the middle typing position.
 */
export function createDocument(characters, profile) {
  const middle = `\n${MARKER}\n\n`;
  const half = Math.floor((characters - middle.length) / 2);
  const section = PROFILES[profile];
  const fill = length => section.repeat(Math.ceil(length / section.length)).slice(0, length);
  const before = fill(half);
  const source = before + middle + fill(characters - middle.length - half);
  return { source, position: before.length + 1 + MARKER.length };
}
