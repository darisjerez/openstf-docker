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

## Revoking a license

```bash
curl -X POST "$WORKER_URL/admin/revoke" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"license_key":"<key>"}'
```

Note: revocation takes effect on the client's next refresh (every 6h),
and only fully kicks in after their 7-day cached token expires.

## Endpoints

| Method | Path             | Auth         | Purpose                       |
|--------|------------------|--------------|-------------------------------|
| POST   | /verify          | none         | Client startup license check  |
| POST   | /admin/create    | X-Admin-Token| Create a new license          |
| GET    | /admin/get       | X-Admin-Token| Inspect a license             |
| POST   | /admin/revoke    | X-Admin-Token| Mark a license revoked        |
