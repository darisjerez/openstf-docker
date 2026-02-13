const express = require('express')
const r = require('rethinkdb')

const app = express()

async function collectMetrics() {
  let conn

  try {
    conn = await r.connect({
      host: '127.0.0.1',
      port: 28015,
      db: 'stf'
    })

    const cursor = await r.table('devices').run(conn)
    const devices = await cursor.toArray()

    const total = devices.length

    // YOUR working logic
    const onlineDevices = devices.filter(d => d.present === true)
    const online = onlineDevices.length
    const offline = total - online

    let output = ''

    // Fleet totals
    output += `# HELP stf_devices_total Total number of STF devices\n`
    output += `# TYPE stf_devices_total gauge\n`
    output += `stf_devices_total ${total}\n`

    output += `# HELP stf_devices_online Number of online STF devices\n`
    output += `# TYPE stf_devices_online gauge\n`
    output += `stf_devices_online ${online}\n`

    output += `# HELP stf_devices_offline Number of offline STF devices\n`
    output += `# TYPE stf_devices_offline gauge\n`
    output += `stf_devices_offline ${offline}\n`

    // Per-device metric
    output += `# HELP stf_device_online Device online status (1 = online, 0 = offline)\n`
    output += `# TYPE stf_device_online gauge\n`

    devices.forEach(device => {
      const isOnline = device.present === true ? 1 : 0

      const serial = device.serial || 'unknown'
      const model = (device.model || 'unknown').replace(/"/g, '')

      output += `stf_device_online{serial="${serial}",model="${model}"} ${isOnline}\n`
    })

    return output

  } catch (err) {
    console.error('Exporter error:', err)
    return ''
  } finally {
    if (conn) await conn.close()
  }
}

app.get('/metrics', async (_req, res) => {
  const metrics = await collectMetrics()
  res.set('Content-Type', 'text/plain')
  res.send(metrics)
})

app.listen(9105, () => {
  console.log('STF exporter running on :9105')
})
