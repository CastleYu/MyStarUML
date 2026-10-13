const MarkdownIt = require('markdown-it')

// Model documentation is untrusted in both the preview and HTML export.
// Keep raw HTML disabled and use markdown-it's safe URL validation.
const parser = new MarkdownIt('commonmark', { html: false })

module.exports = function renderMarkdown (text) {
  return parser.render(text == null ? '' : String(text))
}
