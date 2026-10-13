const assert = require('node:assert/strict')
const vm = require('node:vm')
const render = require('../src/utils/render-markdown')

assert.match(render('# Title\n\n**bold** and _italic_\n\n- item'), /<h1>Title<\/h1>/)
assert.match(render('**bold** and _italic_'), /<strong>bold<\/strong> and <em>italic<\/em>/)
assert.match(render('[docs](https://example.com)'), /href="https:\/\/example.com"/)
assert.match(render('`<script>`'), /<code>&lt;script&gt;<\/code>/)
assert.ok(!render('<script>alert(1)</script>').includes('<script>'))
assert.ok(!render('[bad](javascript:alert(1))').includes('href="javascript:'))
assert.equal(render(null), '')
// Bound execution time so a parsing regression cannot hang the test suite.
vm.runInNewContext("render('_'.repeat(100000)+'x');render(('a_').repeat(50000))", { render }, { timeout: 5000 })
console.log('Markdown semantics, unsafe HTML/URLs and underscore stress checks passed')
