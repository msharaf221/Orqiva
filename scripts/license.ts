/**
 * Orqiva license tool (vendor side). Keep the private key OFF customer machines.
 *
 *   npm run license -- keygen  <private-key-file>
 *   npm run license -- issue   <private-key-file> --customer "اسم العميل" --addons crm,hr [--expires 2027-12-31]
 *   npm run license -- verify  <public-key> <license-key>
 *
 * `keygen` writes the private key to a file and prints the public key. Put the public
 * key in the customer build as ORQIVA_LICENSE_PUBLIC_KEY. `issue` prints the license key
 * for the customer to paste in Settings > License. Use `--addons '*'` for all add-ons.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLicense, type LicensePayload } from '../server/license';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

if (cmd === 'keygen') {
  const out = rest[0];
  if (!out) throw new Error('usage: keygen <private-key-file>');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log('Private key written to', out, '(keep it secret and backed up)');
  console.log(
    'ORQIVA_LICENSE_PUBLIC_KEY=' +
      publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  );
} else if (cmd === 'issue') {
  const priv = createPrivateKey(readFileSync(rest[0], 'utf8'));
  const customer = flag('customer');
  if (!customer) throw new Error('--customer is required');
  const payload: LicensePayload = {
    v: 1,
    customer,
    addons: (flag('addons') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    issued: new Date().toISOString().slice(0, 10),
    expires: flag('expires') ?? null,
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  console.log(`${bytes.toString('base64url')}.${sign(null, bytes, priv).toString('base64url')}`);
} else if (cmd === 'verify') {
  const pub = createPublicKey({ key: Buffer.from(rest[0], 'base64'), format: 'der', type: 'spki' });
  const p = parseLicense(rest[1], pub);
  console.log(p ? JSON.stringify(p, null, 2) : 'INVALID');
  process.exit(p ? 0 : 1);
} else {
  console.log('usage: keygen | issue | verify (see header of this file)');
  process.exit(1);
}
