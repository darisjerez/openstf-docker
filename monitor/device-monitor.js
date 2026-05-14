const express = require('express')
const { execFile } = require('child_process')
const app = express()
const PORT = 9107
const POLL_INTERVAL = 60000 // 60s
const ADB_TIMEOUT = 10000
const ADB_GLOBAL_ARGS = [
  ...(process.env.ADB_HOST ? ['-H', process.env.ADB_HOST] : []),
  ...(process.env.ADB_PORT ? ['-P', process.env.ADB_PORT] : []),
]
const RECONNECT_AFTER = 3 // consecutive offline polls before auto-reconnect
const MAX_RECONNECT_ATTEMPTS = 3 // max reconnect attempts per offline streak

// State per device: { serial: { online, batteryLevel, model, offlineStreak, reconnectAttempts, lastSeen, errors } }
const devices = {}

// Global error counters
let pollErrors = 0

function adb(serial, args) {
  return new Promise((resolve, reject) => {
    execFile('adb', [...ADB_GLOBAL_ARGS, '-s', serial, ...args], { timeout: ADB_TIMEOUT }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve(stdout.trim())
    })
  })
}

function adbNoSerial(args) {
  return new Promise((resolve, reject) => {
    execFile('adb', [...ADB_GLOBAL_ARGS, ...args], { timeout: ADB_TIMEOUT }, (err, stdout) => {
      if (err) return reject(err)
      resolve(stdout.trim())
    })
  })
}

function adbDevices() {
  return new Promise((resolve, reject) => {
    execFile('adb', [...ADB_GLOBAL_ARGS, 'devices'], { timeout: ADB_TIMEOUT }, (err, stdout) => {
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

async function tryReconnect(serial) {
  const state = devices[serial]
  if (!state || state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return false

  state.reconnectAttempts++
  console.log(`[${serial}] auto-reconnect attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`)

  try {
    await adbNoSerial(['reconnect', serial])
    // Wait a moment for reconnect to take effect
    await new Promise(r => setTimeout(r, 3000))

    // Check if device came back
    const connected = await adbDevices()
    if (connected.includes(serial)) {
      console.log(`[${serial}] reconnect SUCCESS`)
      state.online = true
      state.offlineStreak = 0
      state.reconnectAttempts = 0
      state.lastSeen = Date.now()
      return true
    }
    console.log(`[${serial}] reconnect failed — device still offline`)
    return false
  } catch (err) {
    state.errors.reconnect++
    console.error(`[${serial}] reconnect error:`, err.message)
    return false
  }
}

async function pollDevices() {
  let connectedSerials = []
  try {
    connectedSerials = await adbDevices()
  } catch (err) {
    pollErrors++
    console.error('adb devices failed:', err.message)
    return
  }

  const now = Date.now()

  // Mark known devices offline first, then update connected ones
  for (const serial of Object.keys(devices)) {
    if (!connectedSerials.includes(serial)) {
      devices[serial].online = false
      devices[serial].offlineStreak++

      // Auto-reconnect if offline for enough consecutive polls
      if (devices[serial].offlineStreak === RECONNECT_AFTER) {
        await tryReconnect(serial)
      }
    }
  }

  for (const serial of connectedSerials) {
    if (!devices[serial]) {
      devices[serial] = {
        online: true,
        batteryLevel: -1,
        model: '',
        offlineStreak: 0,
        reconnectAttempts: 0,
        lastSeen: now,
        errors: { battery: 0, model: 0, reconnect: 0 }
      }
    }
    devices[serial].online = true
    devices[serial].offlineStreak = 0
    devices[serial].reconnectAttempts = 0
    devices[serial].lastSeen = now

    // Fetch model (once)
    if (!devices[serial].model) {
      try {
        devices[serial].model = await adb(serial, ['shell', 'getprop', 'ro.product.model'])
      } catch (e) {
        devices[serial].errors.model++
      }
    }

    // Read battery level
    try {
      const batteryDump = await adb(serial, ['shell', 'dumpsys', 'battery'])
      const match = batteryDump.match(/level:\s*(\d+)/)
      if (match) devices[serial].batteryLevel = parseInt(match[1], 10)
    } catch (e) {
      devices[serial].errors.battery++
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
    '# TYPE device_online gauge',
    '# HELP device_offline_streak Consecutive polls device has been offline',
    '# TYPE device_offline_streak gauge',
    '# HELP device_last_seen_timestamp Unix timestamp of last time device was online',
    '# TYPE device_last_seen_timestamp gauge',
    '# HELP device_reconnect_attempts Number of auto-reconnect attempts for current offline streak',
    '# TYPE device_reconnect_attempts gauge',
    '# HELP device_errors_total Cumulative error count by type',
    '# TYPE device_errors_total counter',
    '# HELP device_monitor_poll_errors_total Number of failed adb devices polls',
    '# TYPE device_monitor_poll_errors_total counter'
  ]

  lines.push(`device_monitor_poll_errors_total ${pollErrors}`)

  for (const [serial, state] of Object.entries(devices)) {
    const model = state.model || ''
    const labels = `serial="${serial}",model="${model}"`
    lines.push(`device_online{${labels}} ${state.online ? 1 : 0}`)
    if (state.batteryLevel >= 0) {
      lines.push(`device_battery_level{${labels}} ${state.batteryLevel}`)
    }
    lines.push(`device_offline_streak{${labels}} ${state.offlineStreak}`)
    lines.push(`device_last_seen_timestamp{${labels}} ${Math.floor(state.lastSeen / 1000)}`)
    lines.push(`device_reconnect_attempts{${labels}} ${state.reconnectAttempts}`)
    lines.push(`device_errors_total{${labels},type="battery"} ${state.errors.battery}`)
    lines.push(`device_errors_total{${labels},type="model"} ${state.errors.model}`)
    lines.push(`device_errors_total{${labels},type="reconnect"} ${state.errors.reconnect}`)
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
