import { Router, text } from 'express';
import { getDeviceBySerial, insertPunches, parseAdmsPunches } from '../attendance_devices';
import { run, now } from '../db';

/**
 * ZKTeco ADMS (Automatic Data Master Server) Push Protocol.
 *
 * Biometric attendance devices (ZKTeco, Granding, Timmy, etc.) configured in ADMS mode
 * communicate directly with these endpoints over HTTP without third-party middleware:
 *
 *   - GET  /iclock/cdata?SN=...        Device handshake and configuration (Cairo timezone, realtime push)
 *   - POST /iclock/cdata?SN=...&table=ATTLOG  Ingest attendance punch logs in real time
 *   - GET  /iclock/getrequest?SN=...   Poll for pending server commands
 *   - POST /iclock/devicecmd?SN=...    Report command execution status
 */
export const iclockRouter = Router();

// Handle plain text bodies from ZKTeco devices (which send text/plain or octet-stream without JSON)
iclockRouter.use(
  text({
    type: ['text/*', 'application/octet-stream', 'application/x-www-form-urlencoded'],
    limit: '5mb',
  }),
);

iclockRouter.get('/cdata', (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  if (!sn) {
    return res.status(400).type('text/plain').send('ERROR: Missing SN');
  }

  const device = getDeviceBySerial(sn);
  if (!device) {
    return res.type('text/plain').send(`UNREGISTERED_DEVICE: ${sn}`);
  }

  run('UPDATE attendance_devices SET last_seen_at=? WHERE id=?', now(), device.id);

  // Standard ZKTeco configuration response:
  // TimeZone=2 (Cairo wall-clock), Realtime=1 (push punches immediately)
  const config = [
    `GET OPTION FROM: ${sn}`,
    'Stamp=9999',
    'OpStamp=None',
    'PhotoStamp=None',
    'ErrorDelay=60',
    'Delay=30',
    'TransTimes=00:00;14:00',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog',
    'TimeZone=2',
    'Realtime=1',
    'Encrypt=0',
    '',
  ].join('\n');

  res.type('text/plain').send(config);
});

iclockRouter.post('/cdata', (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim();

  if (!sn) {
    return res.status(400).type('text/plain').send('ERROR: Missing SN');
  }

  const device = getDeviceBySerial(sn);
  if (!device) {
    return res.type('text/plain').send('ERROR: UNREGISTERED_DEVICE');
  }

  const bodyText = typeof req.body === 'string' ? req.body : '';
  if (!bodyText.trim()) {
    return res.type('text/plain').send('OK: 0');
  }

  // Parse punch records and insert into attendance_punches + aggregate to employee_attendance
  const punches = parseAdmsPunches(bodyText);
  const result = insertPunches(device, punches, 'DEVICE');

  res.type('text/plain').send(`OK: ${result.accepted}`);
});

iclockRouter.get('/getrequest', (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '').trim();
  if (sn) {
    const device = getDeviceBySerial(sn);
    if (device) {
      run('UPDATE attendance_devices SET last_seen_at=? WHERE id=?', now(), device.id);
    }
  }
  // Return OK indicating no pending remote commands
  res.type('text/plain').send('OK');
});

iclockRouter.post('/devicecmd', (_req, res) => {
  res.type('text/plain').send('OK');
});

iclockRouter.get('/ping', (_req, res) => {
  res.type('text/plain').send('PONG');
});
