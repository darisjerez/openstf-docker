const express = require('express')
const r = require('rethinkdb')

const PORT = 9109
const DB = 'stf'
const TABLE = 'device_info'

const app = express()
app.use(express.json())

async function getConn() {
  return r.connect({ host: '127.0.0.1', port: 28015, db: DB })
}

async function ensureTable() {
  let conn
  try {
    conn = await getConn()
    const tables = await r.tableList().run(conn)
    if (!tables.includes(TABLE)) {
      await r.tableCreate(TABLE, { primaryKey: 'serial' }).run(conn)
      console.log('Created table:', TABLE)
    }
  } catch (err) {
    console.error('Failed to ensure table:', err.message)
  } finally {
    if (conn) await conn.close()
  }
}

// GET /api/device-info — all devices
app.get('/api/device-info', async (_req, res) => {
  let conn
  try {
    conn = await getConn()
    const cursor = await r.table(TABLE).run(conn)
    const docs = await cursor.toArray()
    // Return as { serial: { label, account, password, activationDate } }
    const result = {}
    docs.forEach(d => {
      const { serial, ...fields } = d
      result[serial] = fields
    })
    res.json(result)
  } catch (err) {
    console.error('GET all error:', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    if (conn) await conn.close()
  }
})

// GET /api/device-info/:serial — single device
app.get('/api/device-info/:serial', async (req, res) => {
  let conn
  try {
    conn = await getConn()
    const doc = await r.table(TABLE).get(req.params.serial).run(conn)
    if (!doc) return res.json({})
    const { serial, ...fields } = doc
    res.json(fields)
  } catch (err) {
    console.error('GET error:', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    if (conn) await conn.close()
  }
})

// PUT /api/device-info/:serial — upsert device info
app.put('/api/device-info/:serial', async (req, res) => {
  let conn
  try {
    const { label, account, password, activationDate } = req.body
    const doc = {
      serial: req.params.serial,
      label: label || '',
      account: account || '',
      password: password || '',
      activationDate: activationDate || '',
      updatedAt: Date.now()
    }
    conn = await getConn()
    await r.table(TABLE).insert(doc, { conflict: 'replace' }).run(conn)
    res.json({ ok: true })
  } catch (err) {
    console.error('PUT error:', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    if (conn) await conn.close()
  }
})

ensureTable().then(() => {
  app.listen(PORT, () => {
    console.log('Device info service running on :' + PORT)
  })
})
