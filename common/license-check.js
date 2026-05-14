const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const API_URL = process.env.LICENSE_API_URL
const KEY = process.env.LICENSE_KEY
const PUBKEY_B64 = process.env.LICENSE_PUBLIC_KEY
const CACHE = process.env.LICENSE_CACHE || '/var/lib/openstf/license.token'

function installId() {
  if (process.env.LICENSE_INSTALL_ID) return process.env.LICENSE_INSTALL_ID
  const macs = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') macs.push(i.mac)
    }
  }
  return crypto
    .createHash('sha256')
    .update(macs.sort().join(',') + os.hostname())
    .digest('hex')
    .slice(0, 16)
}

function verifyToken(token) {
  if (typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)
  let payload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString())
  } catch {
    return null
  }
  const pub = crypto.createPublicKey({
    key: Buffer.from(PUBKEY_B64, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const ok = crypto.verify(
    null,
    Buffer.from(JSON.stringify(payload)),
    pub,
    Buffer.from(sigB64, 'base64')
  )
  return ok ? payload : null
}

async function fetchToken() {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ license_key: KEY, install_id: installId() }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return await res.json()
}

async function checkLicense() {
  if (!API_URL || !KEY || !PUBKEY_B64) {
    console.error('[license] missing LICENSE_API_URL / LICENSE_KEY / LICENSE_PUBLIC_KEY')
    process.exit(1)
  }
  const now = Math.floor(Date.now() / 1000)
  try {
    const { token } = await fetchToken()
    const p = verifyToken(token)
    if (!p) throw new Error('signature invalid')
    if (p.license_key !== KEY) throw new Error('key mismatch')
    if (p.install_id !== installId()) throw new Error('install_id mismatch')
    fs.mkdirSync(path.dirname(CACHE), { recursive: true })
    fs.writeFileSync(CACHE, token)
    console.log(
      `[license] ok: ${p.client_name}, license expires ${new Date(p.expires_at * 1000).toISOString()}`
    )
    return p
  } catch (err) {
    console.warn(`[license] fresh check failed (${err.message}); trying cache`)
    let token = null
    try {
      token = fs.readFileSync(CACHE, 'utf8')
    } catch {}
    const p = token && verifyToken(token)
    if (!p || p.license_key !== KEY || p.valid_until < now) {
      console.error('[license] no valid cached token — refusing to start')
      process.exit(1)
    }
    const daysLeft = Math.floor((p.valid_until - now) / 86400)
    console.warn(`[license] running on cached token, ${daysLeft}d remaining`)
    return p
  }
}

function startRefreshLoop() {
  const SIX_HOURS = 6 * 3600 * 1000
  setInterval(() => {
    checkLicense().catch((err) => console.warn(`[license] refresh error: ${err.message}`))
  }, SIX_HOURS)
}

module.exports = { checkLicense, startRefreshLoop, installId }
