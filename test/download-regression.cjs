const assert = require('node:assert/strict')
const http = require('node:http')
const https = require('node:https')
const { EventEmitter } = require('node:events')
const download = require('../src/utils/download-buffer')
const fs = require('node:fs')
const domain = require('../src/extensibility/extension-manager-domain')
const binary = Buffer.from([0, 255, 128, 13, 10])
const server = http.createServer((req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { location: '/binary' }); return res.end() }
  if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end() }
  if (req.url === '/unsafe') { res.writeHead(302, { location: 'file:///tmp/no' }); return res.end() }
  if (req.url === '/missing') { res.writeHead(404); return res.end() }
  if (req.url === '/slow') return
  if (req.url === '/broken') { res.writeHead(200, { 'Content-Length': 999 }); res.write(binary); return setImmediate(() => res.destroy()) }
  res.end(binary)
})
const sockets = new Set()
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const fetch = (url, proxy = '') => new Promise(resolve => download(url, proxy, (error, response, body) => resolve({ error, response, body })))
async function main () {
  await listen(server)
  const base = `http://127.0.0.1:${server.address().port}`
  let proxyUrl
  const proxy = http.createServer((req, res) => { proxyUrl = req.url; res.end(binary) })
  try {
    assert.deepEqual((await fetch(base + '/binary')).body, binary)
    assert.deepEqual((await fetch(base + '/redirect')).body, binary)
    assert.equal((await fetch(base + '/missing')).response.statusCode, 404)
    for (const path of ['/loop', '/unsafe', '/broken']) assert.ok((await fetch(base + path)).error, path)
    assert.ok((await fetch('file:///tmp/no')).error)
    await listen(proxy)
    assert.deepEqual((await fetch('http://example.invalid/binary', `http://127.0.0.1:${proxy.address().port}`)).body, binary)
    assert.equal(proxyUrl, 'http://example.invalid/binary')
    const oldProxy = process.env.http_proxy
    process.env.http_proxy = `http://127.0.0.1:${proxy.address().port}`
    try {
      const result = await new Promise(resolve => download('http://example.invalid/env', undefined, (error, response, body) => resolve({ error, body })))
      assert.ifError(result.error)
      assert.deepEqual(result.body, binary)
      assert.equal(proxyUrl, 'http://example.invalid/env')
    } finally {
      if (oldProxy === undefined) delete process.env.http_proxy
      else process.env.http_proxy = oldProxy
    }
    const originalGet = https.get
    https.get = (url, options, callback) => {
      process.nextTick(() => callback({ statusCode: 302, headers: { location: base + '/binary' }, resume () {} }))
      return new EventEmitter()
    }
    try { assert.ok((await fetch('https://example.invalid/downgrade')).error) } finally { https.get = originalGet }
    const output = await new Promise(resolve => domain.downloadFile('ok', base + '/binary', '', (error, path) => resolve({ error, path })))
    assert.equal(output.error, null)
    assert.deepEqual(fs.readFileSync(output.path), binary)
    fs.unlinkSync(output.path)
    const bad = await new Promise(resolve => domain.downloadFile('bad', base + '/missing', '', error => resolve(error)))
    assert.deepEqual(bad, ['BAD_HTTP_STATUS', 404])
    const temp = require('temp')
    const create = temp.createWriteStream
    temp.createWriteStream = () => { throw new Error('Simulated disk error') }
    try {
      const error = await new Promise(resolve => domain.downloadFile('disk', base + '/binary', '', error => resolve(error)))
      assert.equal(error, 'CANNOT_WRITE_TEMP')
    } finally { temp.createWriteStream = create }
    let calls = 0
    domain.downloadFile('cancel', base + '/slow', '', error => { calls++; assert.equal(error, 'CANCELED') })
    domain.downloadFile('cancel', base + '/binary', '', error => assert.equal(error, 'DOWNLOAD_ID_IN_USE'))
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(domain.abortDownload('cancel'), true)
    assert.equal(domain.abortDownload('cancel'), false)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(calls, 1)
    console.log('Binary download, redirect, proxy, error, temp file and cancellation regressions passed')
  } finally {
    for (const socket of sockets) socket.destroy()
    server.close()
    proxy.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
