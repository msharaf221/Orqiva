import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listAddons } from '../server/addons/registry';
import { registerBuiltinAddons } from '../server/addons';

describe('license keygen page', () => {
  it('offers exactly the add-ons the app registers', () => {
    registerBuiltinAddons();
    const html = readFileSync('tools/license-keygen/index.html', 'utf8');
    const inPage = [...html.matchAll(/class="addon" value="([^"]+)"/g)].map((m) => m[1]).sort();
    const inApp = listAddons()
      .map((a: { id: string }) => a.id)
      .sort();
    expect(inPage).toEqual(inApp);
  });
});
