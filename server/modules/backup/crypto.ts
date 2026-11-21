import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  closeSync,
  statSync,
  rmSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';

/**
 * Backup file encryption: AES-256-GCM with a scrypt-derived key.
 * Layout: "ORQBK1" (6) | salt (16) | iv (12) | ciphertext | auth tag (16).
 * Used for cloud copies so the provider never sees business data.
 */
const MAGIC = Buffer.from('ORQBK1');
const key = (pass: string, salt: Buffer) => scryptSync(pass, salt, 32);

export async function encryptFile(src: string, dest: string, passphrase: string): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
  const out = createWriteStream(dest);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  out.write(cipher.getAuthTag());
  await new Promise<void>((res, rej) => out.end((e: unknown) => (e ? rej(e) : res())));
}

export async function decryptFile(src: string, dest: string, passphrase: string): Promise<void> {
  const size = statSync(src).size;
  if (size < MAGIC.length + 16 + 12 + 16) throw new Error('ملف النسخة الاحتياطية غير صالح');
  const fd = openSync(src, 'r');
  const head = Buffer.alloc(MAGIC.length + 28);
  const tag = Buffer.alloc(16);
  readSync(fd, head, 0, head.length, 0);
  readSync(fd, tag, 0, 16, size - 16);
  closeSync(fd);
  if (!head.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = head.subarray(MAGIC.length + 16);
  const decipher = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(src, { start: head.length, end: size - 17 }),
      decipher,
      createWriteStream(dest),
    );
  } catch (error) {
    // Wrong passphrase or tampered file: never leave unauthenticated plaintext behind.
    rmSync(dest, { force: true });
    throw error;
  }
}
