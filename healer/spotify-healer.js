const express = require('express')
const { execFile } = require('child_process')
const app = express()
const PORT = parseInt(process.env.PORT, 10) || 9106
const HEAL_INTERVAL_MIN = 240000  // 4 minutes
const HEAL_INTERVAL_MAX = 360000  // 6 minutes
const ADB_TIMEOUT = 10000
const HUMAN_PAUSE_PROBABILITY = 0.07  // 7% chance per cycle
const VOLUME_VARIATION_PROBABILITY = 0.20  // 20% chance per cycle
const VOLUME_MIN = 8
const VOLUME_MAX = 15

// Configurable playlist pool — popular public Spotify playlists
let playlists = [
  'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',  // Today's Top Hits
  'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd',  // RapCaviar
  'spotify:playlist:37i9dQZF1DX4SBhb3fqCJd',  // Are & Be
  'spotify:playlist:37i9dQZF1DWXRqgorJj26U',  // Rock Classics
  'spotify:playlist:37i9dQZF1DX4o1oenSJRJd',  // Wherever You Are (lofi)
  'spotify:playlist:37i9dQZF1DX1lVhptIYRda'   // Hot Country
]

// State per device: { serial: { watching, spotifyRunning, spotifyPlaying, healCount, healsLaunched, healsPlaySent, humanPauses, playlistChanges, currentPlaylist, currentVolume, lastHealAction, lastError, _timer, _healing } }
const devices = {}

function adb(serial, args) {
  return new Promise((resolve, reject) => {
    execFile('adb', ['-s', serial, ...args], { timeout: ADB_TIMEOUT }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve(stdout.trim())
    })
  })
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function pickRandomPlaylist() {
  if (playlists.length === 0) return null
  return playlists[Math.floor(Math.random() * playlists.length)]
}

async function setVolume(serial, state) {
  const vol = randomInt(VOLUME_MIN, VOLUME_MAX)
  try {
    await adb(serial, ['shell', 'media', 'volume', '--set', String(vol), '--stream', '3'])
    state.currentVolume = vol
  } catch (e) {
    console.error(`[${serial}] volume set failed:`, e.message)
  }
}

async function launchWithPlaylist(serial, state) {
  const playlist = pickRandomPlaylist()
  if (playlist) {
    state.currentPlaylist = playlist
    state.playlistChanges++
    console.log(`[${serial}] opening playlist: ${playlist}`)
    await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', playlist, 'com.spotify.music'])
  } else {
    await adb(serial, ['shell', 'am', 'start', '-n', 'com.spotify.music/.MainActivity'])
  }
}

async function healCycle(serial) {
  const state = devices[serial]
  if (!state || !state.watching || state._healing) return
  state._healing = true

  try {
    // Fetch device model name (once)
    if (!state.model) {
      try {
        state.model = await adb(serial, ['shell', 'getprop', 'ro.product.model'])
      } catch (e) { /* retry next cycle */ }
    }

    // Step 1: Is Spotify running?
    let pid = ''
    try {
      pid = await adb(serial, ['shell', 'pidof', 'com.spotify.music'])
    } catch (e) {
      // pidof returns non-zero if process not found
    }

    state.spotifyRunning = pid.length > 0

    if (!state.spotifyRunning) {
      // Spotify not running — launch it with a random playlist
      state.lastHealAction = 'launched Spotify'
      state.healCount++
      state.healsLaunched++
      console.log(`[${serial}] Spotify not running — launching`)
      await launchWithPlaylist(serial, state)
      await new Promise(r => setTimeout(r, 3000))
      // Send play command after launch
      await adb(serial, ['shell', 'input', 'keyevent', '126'])
      state.spotifyPlaying = true // optimistic
      // Set initial volume
      await setVolume(serial, state)
    } else {
      // Step 2: Is Spotify playing?
      let mediaDump = ''
      try {
        mediaDump = await adb(serial, ['shell', 'dumpsys', 'media_session'])
      } catch (e) {
        state.lastError = 'dumpsys failed: ' + e.message
        state._healing = false
        return
      }

      // Parse for Spotify session and check state=3 (playing)
      const spotifySection = extractSpotifySession(mediaDump)
      const isPlaying = spotifySection && /state=3/.test(spotifySection)
      state.spotifyPlaying = isPlaying

      if (!isPlaying) {
        state.lastHealAction = 'sent play command'
        state.healCount++
        state.healsPlaySent++
        console.log(`[${serial}] Spotify paused — sending play`)
        await adb(serial, ['shell', 'input', 'keyevent', '126'])
        state.spotifyPlaying = true // optimistic
      } else {
        // Spotify is running and playing — simulate human behavior

        // Human pause: small chance to pause then resume after a delay
        if (Math.random() < HUMAN_PAUSE_PROBABILITY) {
          state.humanPauses++
          const pauseDuration = randomInt(30, 120) * 1000
          state.lastHealAction = `human pause (${Math.round(pauseDuration / 1000)}s)`
          console.log(`[${serial}] simulating human pause for ${Math.round(pauseDuration / 1000)}s`)
          await adb(serial, ['shell', 'input', 'keyevent', '127']) // KEYCODE_MEDIA_PAUSE
          state.spotifyPlaying = false
          // Schedule resume — release healing lock during wait
          state._healing = false
          await new Promise(r => setTimeout(r, pauseDuration))
          if (!state.watching) return // stopped during pause
          state._healing = true
          await adb(serial, ['shell', 'input', 'keyevent', '126']) // KEYCODE_MEDIA_PLAY
          state.spotifyPlaying = true
          console.log(`[${serial}] resumed after human pause`)
        }
      }

      // Volume variation: 20% chance to change volume
      if (Math.random() < VOLUME_VARIATION_PROBABILITY) {
        await setVolume(serial, state)
      }
    }

    state.lastError = null
  } catch (err) {
    state.lastError = err.message
    console.error(`[${serial}] heal error:`, err.message)
  } finally {
    state._healing = false
  }
}

function extractSpotifySession(dump) {
  // Find the section for Spotify's media session
  const lines = dump.split('\n')
  let inSpotify = false
  let section = []
  let braceDepth = 0

  for (const line of lines) {
    if (line.includes('com.spotify.music') && !inSpotify) {
      inSpotify = true
      section = [line]
      braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length
      continue
    }
    if (inSpotify) {
      section.push(line)
      braceDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length
      if (braceDepth <= 0) break
    }
  }

  return inSpotify ? section.join('\n') : null
}

function startWatching(serial, duration) {
  if (devices[serial] && devices[serial].watching) return devices[serial]

  const state = {
    watching: true,
    spotifyRunning: false,
    spotifyPlaying: false,
    healCount: 0,
    healsLaunched: 0,
    healsPlaySent: 0,
    humanPauses: 0,
    playlistChanges: 0,
    currentPlaylist: null,
    currentVolume: null,
    model: '',
    lastHealAction: null,
    lastError: null,
    duration: duration || 0,
    expiresAt: duration > 0 ? Date.now() + duration : 0,
    _healing: false,
    _timer: null,
    _durationTimer: null
  }

  // Auto-stop after duration
  if (duration > 0) {
    state._durationTimer = setTimeout(() => {
      console.log(`[${serial}] duration expired — stopping`)
      stopWatching(serial)
    }, duration)
  }

  // Schedule heal cycles with randomized intervals (4-6 min) to avoid detectable patterns
  function scheduleNext() {
    const jitter = HEAL_INTERVAL_MIN + Math.floor(Math.random() * (HEAL_INTERVAL_MAX - HEAL_INTERVAL_MIN))
    state._timer = setTimeout(async () => {
      await healCycle(serial)
      if (state.watching) scheduleNext()
    }, jitter)
  }
  // Stagger first cycle with a random delay so devices don't all heal at once
  const stagger = Math.floor(Math.random() * HEAL_INTERVAL_MAX)
  state._staggerTimer = setTimeout(() => {
    healCycle(serial)
    scheduleNext()
  }, stagger)
  devices[serial] = state
  console.log(`[${serial}] watcher started (first cycle in ${Math.round(stagger / 1000)}s, interval: ${HEAL_INTERVAL_MIN/1000}–${HEAL_INTERVAL_MAX/1000}s, duration: ${duration ? duration / 1000 + 's' : 'infinite'})`)
  return state
}

function stopWatching(serial) {
  const state = devices[serial]
  if (!state) return false
  state.watching = false
  if (state._staggerTimer) clearTimeout(state._staggerTimer)
  if (state._timer) clearTimeout(state._timer)
  if (state._durationTimer) clearTimeout(state._durationTimer)
  delete devices[serial]
  console.log(`[${serial}] watcher stopped`)
  return true
}

function publicState(state) {
  if (!state) return null
  return {
    watching: state.watching,
    spotifyRunning: state.spotifyRunning,
    spotifyPlaying: state.spotifyPlaying,
    healCount: state.healCount,
    healsLaunched: state.healsLaunched,
    healsPlaySent: state.healsPlaySent,
    humanPauses: state.humanPauses,
    playlistChanges: state.playlistChanges,
    currentPlaylist: state.currentPlaylist,
    currentVolume: state.currentVolume,
    model: state.model,
    lastHealAction: state.lastHealAction,
    lastError: state.lastError,
    duration: state.duration,
    expiresAt: state.expiresAt
  }
}

app.use(express.json())

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// GET /api/status — all watcher states
app.get('/api/status', (req, res) => {
  const result = {}
  for (const serial of Object.keys(devices)) {
    result[serial] = publicState(devices[serial])
  }
  res.json(result)
})

// POST /api/watch/:serial — start watching
app.post('/api/watch/:serial', (req, res) => {
  const duration = (req.body && req.body.duration) || 0
  const state = startWatching(req.params.serial, duration)
  res.json(publicState(state))
})

// DELETE /api/watch/:serial — stop watching
app.delete('/api/watch/:serial', (req, res) => {
  const removed = stopWatching(req.params.serial)
  res.json({ ok: removed })
})

// GET /api/watch/:serial — single device state
app.get('/api/watch/:serial', (req, res) => {
  const state = devices[req.params.serial]
  if (!state) return res.status(404).json({ error: 'not watched' })
  res.json(publicState(state))
})

// GET /api/playlists — view playlist pool
app.get('/api/playlists', (req, res) => {
  res.json({ playlists })
})

// PUT /api/playlists — update playlist pool
app.put('/api/playlists', (req, res) => {
  if (!req.body || !Array.isArray(req.body.playlists)) {
    return res.status(400).json({ error: 'body must contain "playlists" array' })
  }
  playlists = req.body.playlists.filter(p => typeof p === 'string' && p.length > 0)
  console.log(`Playlist pool updated: ${playlists.length} playlists`)
  res.json({ playlists })
})

// GET /metrics — Prometheus metrics
app.get('/metrics', (req, res) => {
  const lines = [
    '# HELP spotify_healer_watching Whether the watcher is active for a device',
    '# TYPE spotify_healer_watching gauge',
    '# HELP spotify_healer_playing Whether Spotify is currently playing on a device',
    '# TYPE spotify_healer_playing gauge',
    '# HELP spotify_healer_heal_total Number of heal actions performed',
    '# TYPE spotify_healer_heal_total counter',
    '# HELP spotify_healer_heals_total Number of heal actions by type',
    '# TYPE spotify_healer_heals_total counter',
    '# HELP spotify_healer_human_pauses_total Number of simulated human pauses',
    '# TYPE spotify_healer_human_pauses_total counter',
    '# HELP spotify_healer_playlist_changes_total Number of playlist rotations',
    '# TYPE spotify_healer_playlist_changes_total counter'
  ]

  for (const [serial, state] of Object.entries(devices)) {
    const model = state.model || ''
    const labels = `serial="${serial}",model="${model}"`
    lines.push(`spotify_healer_watching{${labels}} ${state.watching ? 1 : 0}`)
    lines.push(`spotify_healer_playing{${labels}} ${state.spotifyPlaying ? 1 : 0}`)
    lines.push(`spotify_healer_heal_total{${labels}} ${state.healCount}`)
    lines.push(`spotify_healer_heals_total{${labels},action="launched"} ${state.healsLaunched}`)
    lines.push(`spotify_healer_heals_total{${labels},action="play_sent"} ${state.healsPlaySent}`)
    lines.push(`spotify_healer_human_pauses_total{${labels}} ${state.humanPauses}`)
    lines.push(`spotify_healer_playlist_changes_total{${labels}} ${state.playlistChanges}`)
  }

  res.set('Content-Type', 'text/plain; version=0.0.4')
  res.send(lines.join('\n') + '\n')
})

app.listen(PORT, () => {
  console.log(`Spotify Healer listening on :${PORT}`)
})
