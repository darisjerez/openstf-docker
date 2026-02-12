const express = require('express');
const r = require('rethinkdb');

const app = express();
let metrics = {
  total: 0,
  online: 0,
  offline: 0
};

async function collect() {
  const conn = await r.connect({ host: '127.0.0.1', port: 28015, db: 'stf'});
  const devices = await r.table('devices').run(conn);
  const list = await devices.toArray();

  metrics.total = list.length;
  metrics.online = list.filter(d => d.present).length;
  metrics.offline = metrics.total - metrics.online;
}

app.get('/metrics', async (_req, res) => {
  await collect();
  res.type('text/plain');
  res.send(`
stf_devices_total ${metrics.total}
stf_devices_online ${metrics.online}
stf_devices_offline ${metrics.offline}
`);
});

app.listen(9105, () => {
  console.log('STF exporter on :9105');
});
