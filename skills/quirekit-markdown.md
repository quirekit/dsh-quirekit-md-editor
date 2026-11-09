# Writing rich Markdown for the QuireKit editor

The user reads Markdown files in the QuireKit editor in the DeepSeek Harness sidebar. Use these features when they make a document clearer. Write plain Markdown source: the file stays portable, and anything the editor cannot render stays visible as source.

## Callouts and collapsible sections

Open with at least three colons, a type, and an optional title. Close with at least as many colons. Nest by giving the outer block more colons.

```markdown
:::: decision Release decision
Body text can hold **emphasis**, lists, tables and code.

::: warning Before release
- Confirm the rollback plan
:::
::::
```

Types: `info`, `note`, `tip`, `important`, `warning`, `danger`, `caution`, `decision`, `details` (collapsed by default), and `highlight`.

A highlight block can set its emoji and colors: `::: highlight {emoji=📌 color=purple text=blue}`.

## Diagrams

Use a fenced code block. Each one renders in place, and the source stays editable.

| Fence | Use for |
| --- | --- |
| `mermaid` | Flowcharts, sequence, state, class, ER and Gantt diagrams, mind maps, pie charts |
| `plantuml` | UML class, component, deployment and sequence diagrams; wrap in `@startuml` and `@enduml` |
| `dot` | Graphviz networks and dependency graphs |

Keep one subject per diagram, and write a sentence before or after it saying what it shows.

## Formulas

Inline: `$E = mc^2$`. Block: put `$$` on its own line before and after the formula.

## Inline text

`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `==highlight==`, `++underline++`, `H~2~O` for subscript and `x^2^` for superscript.

## Structure

- Task lists: `- [ ] todo` and `- [x] done`.
- Footnotes: `Text[^key]` with `[^key]: Note` elsewhere, or inline `^[Note]`.
- Definition lists: a term on one line, then `: Definition` on the next.
- Tables use GFM syntax. Cells hold inline formatting only.
- YAML or TOML frontmatter at the top of the file is kept as is.

## Images

Reference screenshots and other local images by path, relative to the Markdown file when possible: `![Result](screenshots/result.png)`. Absolute paths also display; `file://` URLs do not.

## Do not write these by hand

Fences named `quirekit-whiteboard`, `quirekit-flowchart`, `quirekit-mind-map` and `quirekit-data-view` hold generated data and a rendered preview. Never create or edit them as text: use a `mermaid` fence instead, and leave existing ones unchanged.

## Comments

The editor keeps comments in a hidden `.<file name>.comments.json` file beside the document and re-attaches them itself. To act on a comment, change the Markdown file, then call `resolve_document_comment` when the request gives comment IDs. Do not read or edit the comment file, and do not inspect the editor or this plugin, unless the user asks.
