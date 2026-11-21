import { backup } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { db } from '../../db';
import { encryptFile } from './crypto';

/**
 * Backup add-on. Local SQLite stays the source of truth. This module adds:
 *  - consistent online copies into a backup folder, with retention,
 *  - a daily schedule (checked hourly),
 *  - an optional, opt-in cloud copy: the file is encrypted with a passphrase and PUT to a
 *    WebDAV/HTTP URL the customer owns (Nextcloud, a NAS, any storage with a PUT URL).
 *
 * All settings are environment variables, so they live in the customer's install:
 *  ORQIVA_BACKUP_DIR (default ./backups/auto), ORQIVA_BACKUP_KEEP (default 14),
 *  ORQIVA_BACKUP_SCHEDULE=off to disable the daily run,
 *  ORQIVA_BACKUP_CLOUD_URL, ORQIVA_BACKUP_CLOUD_USER, ORQIVA_BACKUP_CLOUD_PASSWORD,
 *  ORQIVA_BACKUP_PASSPHRASE (required for cloud copies).
 */
const PREFIX = 'orqiva-';

export const backupDir = (): string => resolve(process.env.ORQIVA_BACKUP_DIR || 'backups/auto');
const keep = (): number => Math.max(1, Number(process.env.ORQIVA_BACKUP_KEEP) || 14);

export interface BackupFile {
  name: string;
  size: number;
  created_at: string;
}

export interface CloudStatus {
  configured: boolean;
  /** Cloud URL is set but the passphrase is missing, so nothing is uploaded. */
  missing_passphrase: boolean;
}

export function cloudStatus(): CloudStatus {
  const url = (process.env.ORQIVA_BACKUP_CLOUD_URL ?? '').trim();
  const pass = (process.env.ORQIVA_BACKUP_PASSPHRASE ?? '').trim();
  return { configured: !!url && !!pass, missing_passphrase: !!url && !pass };
}

export function listBackups(): BackupFile[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith(PREFIX) && n.endsWith('.db'))
    .map((name) => {
      const st = statSync(resolve(dir, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.name.localeCompare(a.name));
}

/** Resolves a listed backup by name, never a path, so downloads cannot escape the folder. */
export function backupPath(name: string): string | null {
  if (name !== basename(name)) return null;
  return listBackups().some((b) => b.name === name) ? resolve(backupDir(), name) : null;
}

function prune(): void {
  for (const old of listBackups().slice(keep())) unlinkSync(resolve(backupDir(), old.name));
}

async function uploadToCloud(file: string, name: string): Promise<void> {
  const cloud = cloudStatus();
  if (!cloud.configured) return;
  const encrypted = `${file}.enc`;
  try {
    await encryptFile(file, encrypted, process.env.ORQIVA_BACKUP_PASSPHRASE!);
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    const user = process.env.ORQIVA_BACKUP_CLOUD_USER;
    if (user) {
      const pw = process.env.ORQIVA_BACKUP_CLOUD_PASSWORD ?? '';
      headers.Authorization = `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`;
    }
    const base = process.env.ORQIVA_BACKUP_CLOUD_URL!.replace(/\/+$/, '');
    const res = await fetch(`${base}/${name}.enc`, {
      method: 'PUT',
      headers,
      body: await readFile(encrypted),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) throw new Error(`رفض خادم النسخ السحابي الرفع (${res.status})`);
  } finally {
    if (existsSync(encrypted)) unlinkSync(encrypted);
  }
}

export interface BackupResult {
  file: BackupFile;
  cloud: 'uploaded' | 'skipped' | 'failed';
  cloud_error?: string;
}

let running = false;

/** Takes a consistent local copy, prunes old ones, then tries the optional cloud copy. */
export async function runBackup(): Promise<BackupResult> {
  if (running) throw new Error('هناك نسخة احتياطية قيد التنفيذ');
  running = true;
  try {
    mkdirSync(backupDir(), { recursive: true });
    const name = `${PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const dest = resolve(backupDir(), name);
    await backup(db, dest);
    prune();
    const file = listBackups().find((b) => b.name === name)!;
    if (!cloudStatus().configured) return { file, cloud: 'skipped' };
    try {
      await uploadToCloud(dest, name);
      return { file, cloud: 'uploaded' };
    } catch (e) {
      // The local copy exists, so a cloud failure is reported but is not a backup failure.
      return { file, cloud: 'failed', cloud_error: (e as Error).message };
    }
  } finally {
    running = false;
  }
}

/** Runs a backup when the newest one is older than 24 hours. Called hourly by the server. */
export async function runScheduledBackup(now = Date.now()): Promise<BackupResult | null> {
  if ((process.env.ORQIVA_BACKUP_SCHEDULE ?? '').toLowerCase() === 'off') return null;
  const latest = listBackups()[0];
  if (latest && now - Date.parse(latest.created_at) < 24 * 3_600_000) return null;
  return runBackup();
}
