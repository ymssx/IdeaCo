/**
 * Centralized path configuration
 * 
 * In Electron packaged mode, data and workspace directories are set via
 * environment variables (IDEACO_DATA_DIR / IDEACO_WORKSPACE_DIR) to point
 * to the user's persistent userData folder, so that app updates don't
 * overwrite user data.
 * 
 * In dev mode or plain `next dev`, falls back to process.cwd() based paths.
 */
import path from 'path';

export const DATA_DIR = process.env.IDEACO_DATA_DIR
  || path.resolve(process.cwd(), 'data');

export const WORKSPACE_DIR = process.env.IDEACO_WORKSPACE_DIR
  || path.resolve(process.cwd(), 'workspace');

export const MEMORY_DIR = path.join(DATA_DIR, 'memories');
export const CHATS_DIR = path.join(DATA_DIR, 'chats');
export const AUDIT_DIR = path.join(DATA_DIR, 'audit');
export const SKILLS_DIR = path.join(DATA_DIR, 'skills');
export const STATE_FILE = path.join(DATA_DIR, 'company-state.json');
export const BACKUP_FILE = path.join(DATA_DIR, 'company-state.backup.json');
