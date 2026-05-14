const express = require('express');
const os = require('os');
const { execSync } = require('child_process');

const PORT = parseInt(process.env.PORT, 10) || 9108;

const app = express();

// --- CPU usage tracking ---
let prevCpuIdle = 0;
let prevCpuTotal = 0;
let cpuUsagePercent = 0;

function updateCpuUsage() {
  try {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    const diffIdle = idle - prevCpuIdle;
    const diffTotal = total - prevCpuTotal;
    if (diffTotal > 0) {
      cpuUsagePercent = ((1 - diffIdle / diffTotal) * 100);
    }
    prevCpuIdle = idle;
    prevCpuTotal = total;
  } catch (err) {
    console.error('Error reading CPU usage:', err.message);
  }
}

// --- Disk usage ---
function getDiskUsage() {
  const mounts = [];
  try {
    const output = execSync('df -P / /data 2>/dev/null || df -P /', { encoding: 'utf8' });
    const lines = output.trim().split('\n').slice(1); // skip header
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const usagePercent = parseInt(parts[4], 10);
        const mountPoint = parts[5];
        mounts.push({ mount: mountPoint, percent: usagePercent });
      }
    }
  } catch (err) {
    console.error('Error reading disk usage:', err.message);
  }
  return mounts;
}

// --- USB device count ---
function getUsbDeviceCount() {
  try {
    const output = execSync('lsusb 2>/dev/null | wc -l', { encoding: 'utf8' });
    return parseInt(output.trim(), 10) || 0;
  } catch (err) {
    // lsusb may not be available
    return 0;
  }
}

// Update CPU every 5 seconds
setInterval(updateCpuUsage, 5000);
updateCpuUsage();

// --- Prometheus metrics endpoint ---
app.get('/metrics', (req, res) => {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;
  const diskUsage = getDiskUsage();
  const usbCount = getUsbDeviceCount();

  let metrics = '';

  // CPU
  metrics += '# HELP server_cpu_usage_percent Current CPU usage percentage\n';
  metrics += '# TYPE server_cpu_usage_percent gauge\n';
  metrics += `server_cpu_usage_percent ${cpuUsagePercent.toFixed(2)}\n`;

  // Memory
  metrics += '# HELP server_memory_usage_bytes Current memory usage in bytes\n';
  metrics += '# TYPE server_memory_usage_bytes gauge\n';
  metrics += `server_memory_usage_bytes ${memUsed}\n`;

  metrics += '# HELP server_memory_total_bytes Total memory in bytes\n';
  metrics += '# TYPE server_memory_total_bytes gauge\n';
  metrics += `server_memory_total_bytes ${memTotal}\n`;

  // Disk
  metrics += '# HELP server_disk_usage_percent Disk usage percentage by mount point\n';
  metrics += '# TYPE server_disk_usage_percent gauge\n';
  for (const d of diskUsage) {
    metrics += `server_disk_usage_percent{mount="${d.mount}"} ${d.percent}\n`;
  }

  // USB
  metrics += '# HELP server_usb_device_count Number of USB devices detected\n';
  metrics += '# TYPE server_usb_device_count gauge\n';
  metrics += `server_usb_device_count ${usbCount}\n`;

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(metrics);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const { checkLicense, startRefreshLoop } = require('./license-check');

(async () => {
  await checkLicense();
  startRefreshLoop();
  app.listen(PORT, () => {
    console.log(`Resource monitor listening on port ${PORT}`);
  });
})();
