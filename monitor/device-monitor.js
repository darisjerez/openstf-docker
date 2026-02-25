const express = require('express')
const { execFile } = require('child_process')
const app = express()
const PORT = 9107
const POLL_INTERVAL = 60000 // 60s
const ADB_TIMEOUT = 10000

// State per device: { serial: { online, batteryLevel, model } }
const devices = {}

function adb(serial, args) {
  return new Promise((resolve, reject) => {
    execFile('adb', ['-s', serial, ...args], { timeout: ADB_TIMEOUT }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve(stdout.trim())
    })
  })
}

function adbDevices() {
  return new Promise((resolve, reject) => {
    execFile('adb', ['devices'], { timeout: ADB_TIMEOUT }, (err, stdout) => {
      if (err) return reject(err)
      const serials = []
      for (const line of stdout.split('\n')) {
        const match = line.match(/^(\S+)\s+device$/)
        if (match) serials.push(match[1])
      }
      resolve(serials)
    })
  })
}

async function pollDevices() {
  let connectedSerials = []
  try {
    connectedSerials = await adbDevices()
  } catch (err) {
    console.error('adb devices failed:', err.message)
    return
  }

  // Mark all known devices offline, then update connected ones
  for (const serial of Object.keys(devices)) {
    devices[serial].online = false
  }

  for (const serial of connectedSerials) {
    if (!devices[serial]) {
      devices[serial] = { online: true, batteryLevel: -1, model: '' }
    }
    devices[serial].online = true

    // Fetch model (once)
    if (!devices[serial].model) {
      try {
        devices[serial].model = await adb(serial, ['shell', 'getprop', 'ro.product.model'])
      } catch (e) { /* retry next cycle */ }
    }

    // Read battery level
    try {
      const batteryDump = await adb(serial, ['shell', 'dumpsys', 'battery'])
      const match = batteryDump.match(/level:\s*(\d+)/)
      if (match) devices[serial].batteryLevel = parseInt(match[1], 10)
    } catch (e) {
      // Non-fatal — keep previous value
    }
  }

  console.log(`[poll] ${connectedSerials.length} devices connected`)
}

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// GET /metrics — Prometheus metrics
app.get('/metrics', (req, res) => {
  const lines = [
    '# HELP device_battery_level Battery percentage of the device',
    '# TYPE device_battery_level gauge',
    '# HELP device_online Whether the device is connected via ADB',
    '# TYPE device_online gauge'
  ]

  for (const [serial, state] of Object.entries(devices)) {
    const model = state.model || ''
    const labels = `serial="${serial}",model="${model}"`
    lines.push(`device_online{${labels}} ${state.online ? 1 : 0}`)
    if (state.batteryLevel >= 0) {
      lines.push(`device_battery_level{${labels}} ${state.batteryLevel}`)
    }
  }

  res.set('Content-Type', 'text/plain; version=0.0.4')
  res.send(lines.join('\n') + '\n')
})

// Start polling immediately, then every POLL_INTERVAL
pollDevices()
setInterval(pollDevices, POLL_INTERVAL)

app.listen(PORT, () => {
  console.log(`Device Monitor listening on :${PORT}`)
})
