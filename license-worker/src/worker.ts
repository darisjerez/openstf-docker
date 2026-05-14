export interface Env {
  LICENSES: KVNamespace
  SIGNING_KEY_B64: string
  ADMIN_TOKEN: string
}

interface License {
  client_name: string
  expires_at: number
  revoked: boolean
  install_ids: string[]
  max_installs: number
  notes?: string
}

interface VerifyBody {
  license_key?: string
  install_id?: string
}

interface CreateBody {
  client_name: string
  expires_at: number
  max_installs?: number
  notes?: string
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/verify' && req.method === 'POST') return verify(req, env)
    if (url.pathname === '/admin/create' && req.method === 'POST') return adminCreate(req, env)
    if (url.pathname === '/admin/get' && req.method === 'GET') return adminGet(req, env)
    if (url.pathname === '/admin/revoke' && req.method === 'POST') return adminRevoke(req, env)
    return new Response('Not found', { status: 404 })
  },
}

async function verify(req: Request, env: Env): Promise<Response> {
  const body = (await req.json()) as VerifyBody
  if (!body.license_key || !body.install_id) return json({ error: 'missing' }, 400)

  const raw = await env.LICENSES.get(body.license_key)
  if (!raw) return json({ error: 'invalid' }, 403)
  const lic = JSON.parse(raw) as License

  const now = Math.floor(Date.now() / 1000)
  if (lic.revoked) return json({ error: 'revoked' }, 403)
  if (now > lic.expires_at) return json({ error: 'expired' }, 403)

  if (!lic.install_ids.includes(body.install_id)) {
    if (lic.install_ids.length >= lic.max_installs) {
      return json({ error: 'install_limit' }, 403)
    }
    lic.install_ids.push(body.install_id)
    await env.LICENSES.put(body.license_key, JSON.stringify(lic))
  }

  const payload = {
    license_key: body.license_key,
    install_id: body.install_id,
    client_name: lic.client_name,
    expires_at: lic.expires_at,
    valid_until: now + 7 * 86400,
    issued_at: now,
  }
  const token = await sign(payload, env.SIGNING_KEY_B64)
  return json({ token, payload })
}

async function adminCreate(req: Request, env: Env): Promise<Response> {
  if (!isAdmin(req, env)) return json({ error: 'auth' }, 401)
  const body = (await req.json()) as CreateBody
  if (!body.client_name || !body.expires_at) return json({ error: 'missing' }, 400)
  const license_key = crypto.randomUUID().replace(/-/g, '')
  const lic: License = {
    client_name: body.client_name,
    expires_at: body.expires_at,
    revoked: false,
    install_ids: [],
    max_installs: body.max_installs || 1,
    notes: body.notes,
  }
  await env.LICENSES.put(license_key, JSON.stringify(lic))
  return json({ license_key, ...lic })
}

async function adminGet(req: Request, env: Env): Promise<Response> {
  if (!isAdmin(req, env)) return json({ error: 'auth' }, 401)
  const url = new URL(req.url)
  const key = url.searchParams.get('license_key')
  if (!key) return json({ error: 'missing license_key' }, 400)
  const raw = await env.LICENSES.get(key)
  if (!raw) return json({ error: 'not_found' }, 404)
  return json({ license_key: key, ...JSON.parse(raw) })
}

async function adminRevoke(req: Request, env: Env): Promise<Response> {
  if (!isAdmin(req, env)) return json({ error: 'auth' }, 401)
  const body = (await req.json()) as { license_key: string }
  if (!body.license_key) return json({ error: 'missing' }, 400)
  const raw = await env.LICENSES.get(body.license_key)
  if (!raw) return json({ error: 'not_found' }, 404)
  const lic = JSON.parse(raw) as License
  lic.revoked = true
  await env.LICENSES.put(body.license_key, JSON.stringify(lic))
  return json({ ok: true, license_key: body.license_key })
}

function isAdmin(req: Request, env: Env): boolean {
  return req.headers.get('x-admin-token') === env.ADMIN_TOKEN
}

async function sign(payload: object, keyB64: string): Promise<string> {
  const msg = new TextEncoder().encode(JSON.stringify(payload))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    b64ToBuf(keyB64),
    { name: 'Ed25519' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('Ed25519', key, msg)
  return btoa(JSON.stringify(payload)) + '.' + bufToB64(sig)
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const bufToB64 = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))

const b64ToBuf = (s: string) => {
  const bin = atob(s)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}
