const http = require('http')
const https = require('https')
const { HttpProxyAgent } = require('http-proxy-agent')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { getProxyForUrl } = require('proxy-from-env')

// Extension downloads need binary GETs, redirects, proxy support and cancellation.
// Keep each redirect explicit so unsupported schemes and TLS downgrades fail closed.
module.exports = function downloadBuffer (address, proxy, callback) {
  const agents = []
  let active
  let completed = false
  function finish (error, response, body) {
    if (completed) return
    completed = true
    agents.forEach(agent => agent.destroy())
    callback(error, response, body)
  }
  function get (address, previous, count) {
    if (completed) return
    try {
      const url = new URL(address, previous)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          (previous && previous.protocol === 'https:' && url.protocol !== 'https:')) {
        throw new Error('Unsafe extension download URL or redirect')
      }
      const proxyUrl = proxy === undefined ? getProxyForUrl(url.href) : proxy
      let agent
      if (proxyUrl) {
        if (!['http:', 'https:'].includes(new URL(proxyUrl).protocol)) throw new Error('Unsupported proxy protocol')
        agent = url.protocol === 'https:' ? new HttpsProxyAgent(proxyUrl) : new HttpProxyAgent(proxyUrl)
        agents.push(agent)
      }
      active = (url.protocol === 'https:' ? https : http).get(url, { agent }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume()
          if (count >= 10) return finish(new Error('Too many redirects'))
          return get(response.headers.location, url, count + 1)
        }
        if (response.statusCode !== 200) {
          response.resume()
          return finish(null, response)
        }
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => finish(null, response, Buffer.concat(chunks)))
        response.on('error', finish)
        response.on('aborted', () => finish(new Error('Download interrupted')))
      })
      active.on('error', finish)
    } catch (error) {
      finish(error)
    }
  }
  // Ensure callers can register the returned handle before any failure callback.
  process.nextTick(() => get(address, undefined, 0))
  return {
    abort () {
      completed = true
      if (active) active.destroy()
      agents.forEach(agent => agent.destroy())
    }
  }
}
