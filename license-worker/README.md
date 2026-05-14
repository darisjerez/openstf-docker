# License Worker

Cloudflare Worker that issues signed license tokens for OpenSTF client
services. Clients call `POST /verify` at startup; the Worker checks the
KV store and returns an Ed25519-signed token valid for 7 days.

## Setup

```bash
cd license-worker
npm install

# 1. Generate signing key pair
node scripts/keygen.js
# Copy PRIVATE → step 4 (wrangler secret)
# Copy PUBLIC  → distributed to each client as LICENSE_PUBLIC_KEY env

# 2. Create KV namespace
npx wrangler kv namespace create LICENSES
# Paste the returned id into wrangler.toml (kv_namespaces.id)

# 3. Choose an admin token (any random string)
openssl rand -hex 32

# 4. Set secrets
npx wrangler secret put SIGNING_KEY_B64    # paste private key
npx wrangler secret put ADMIN_TOKEN        # paste admin token

# 5. Deploy
npx wrangler deploy
```

The deploy command prints the Worker URL — distribute this as
`LICENSE_API_URL` (append `/verify`) to each client.

## Creating a license

```bash
WORKER_URL=https://openstf-license.example.workers.dev \
ADMIN_TOKEN=... \
./scripts/create-license.sh "Acme Corp" 2026-12-31 1
```

Output includes the new `license_key` — share that with the client along
with `LICENSE_API_URL` and `LICENSE_PUBLIC_KEY`.

## Revoking vs killing

Two flavors, different urgency:

- **`/admin/revoke` — polite.** Marks the license revoked. /verify
  returns 403 on next refresh. The client's cached token keeps it
  running for up to 7 days, then the service refuses to start. Use this
  for non-renewals, late payment, etc.

- **`/admin/kill` — hard.** Sets `kill_immediately` on the license. The
  next /verify returns 200 with a signed token whose `kill_at = now`.
  The client verifies the signature, wipes its cache, and exits. Effect
  lands within one refresh interval (~6h by default) — and a manual
  `docker compose restart` will trigger it sooner. Use for breach of
  contract, piracy, etc.

`/admin/unkill` clears both flags (useful if you killed by mistake).

```bash
# Polite revoke
curl -X POST "$WORKER_URL/admin/revoke" \
  -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"license_key":"<key>"}'

# Hard kill
curl -X POST "$WORKER_URL/admin/kill" \
  -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"license_key":"<key>"}'

# Restore
curl -X POST "$WORKER_URL/admin/unkill" \
  -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"license_key":"<key>"}'
```

## Endpoints

| Method | Path             | Auth          | Purpose                          |
|--------|------------------|---------------|----------------------------------|
| POST   | /verify          | none          | Client startup license check     |
| POST   | /admin/create    | X-Admin-Token | Create a new license             |
| GET    | /admin/get       | X-Admin-Token | Inspect a license                |
| POST   | /admin/revoke    | X-Admin-Token | Polite revoke (7-day grace)      |
| POST   | /admin/kill      | X-Admin-Token | Hard kill (forces exit at next refresh) |
| POST   | /admin/unkill    | X-Admin-Token | Clear revoke + kill flags        |
