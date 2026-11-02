import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export function appDataDir(): string {
  return app.getPath('userData');
}

export function ensureDirs(): { dbPath: string; originalsDir: string; thumbsDir: string; rendersDir: string; exportsDir: string; backupsDir: string } {
  const base = appDataDir();
  const dbPath = path.join(base, 'pinstudio.db');
  const originalsDir = path.join(base, 'originals');
  const thumbsDir = path.join(base, 'thumbs');
  const rendersDir = path.join(base, 'renders');
  const exportsDir = path.join(base, 'Exports');
  const backupsDir = path.join(base, 'backups');
  for (const d of [originalsDir, thumbsDir, rendersDir, exportsDir, backupsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return { dbPath, originalsDir, thumbsDir, rendersDir, exportsDir, backupsDir };
}
