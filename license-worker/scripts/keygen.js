#!/usr/bin/env node
// Generate an Ed25519 keypair for the license worker.
//   PRIVATE → wrangler secret put SIGNING_KEY_B64
//   PUBLIC  → bake into client images as LICENSE_PUBLIC_KEY env
const { generateKeyPairSync } = require('crypto')

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

console.log('SIGNING_KEY_B64 (worker secret, do NOT commit):')
console.log(priv)
console.log('')
console.log('LICENSE_PUBLIC_KEY (bake into client env, safe to share):')
console.log(pub)
