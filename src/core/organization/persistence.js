/**
 * Persistence Storage Module
 * 
 * Serializes Company's full state to disk (JSON), auto-restores after server restart.
 * Storage location: under project root data/ directory.
 */
import fs from 'fs';
import { saveAllAgentMemories, loadAgentMemory, clearAllMemories } from '../employee/memory/store.js';
import { DATA_DIR, STATE_FILE, BACKUP_FILE, CHATS_DIR } from '../../lib/paths.js';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Save company state to disk
 * @param {Company} company - Company instance
 */
export function saveState(company) {
  if (!company) return;
  try {
    // Collect all Agent memories, save to separate files
    const agentMemories = [];
    company.departments.forEach(dept => {
      dept.getMembers().forEach(agent => {
        agentMemories.push({
          agentId: agent.id,
          memoryData: agent.memory.serialize(),
          meta: { name: agent.name, role: agent.role, department: dept.name },
        });
      });
    });
    // Secretary's memory also saved separately
    if (company.secretary) {
      agentMemories.push({
        agentId: company.secretary.id,
        memoryData: company.secretary.memory.serialize(),
        meta: { name: company.secretary.name, role: 'Personal Secretary', department: 'HQ' },
      });
    }
    saveAllAgentMemories(agentMemories);

    const serialized = company.serialize();
    const json = JSON.stringify(serialized, null, 2);

    // Backup old file first
    if (fs.existsSync(STATE_FILE)) {
      fs.copyFileSync(STATE_FILE, BACKUP_FILE);
    }

    // Write new state
    fs.writeFileSync(STATE_FILE, json, 'utf-8');
    console.log(`💾 State persisted (${(json.length / 1024).toFixed(1)}KB)`);
  } catch (e) {
    console.error('❌ Persistence failed:', e.message);
  }
}

/**
 * Load company state from disk
 * @returns {object|null} Serialized state data, or null
 */
export function loadState() {
  try {
    let filePath = STATE_FILE;
    if (!fs.existsSync(filePath)) {
      filePath = BACKUP_FILE;
      if (!fs.existsSync(filePath)) return null;
    }

    const json = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(json);
    console.log(`📂 State loaded from disk: ${data.name || 'unknown'}`);
    return data;
  } catch (e) {
    console.error('❌ Failed to load state:', e.message);
    return null;
  }
}

/**
 * Delete persisted data (reset)
 */
export function clearState() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    clearAllMemories();
    // Clear all chat files (including group chats stored in data/chats/)
    if (fs.existsSync(CHATS_DIR)) {
      fs.rmSync(CHATS_DIR, { recursive: true, force: true });
      fs.mkdirSync(CHATS_DIR, { recursive: true });
    }
    console.log('🗑️ Persisted data cleared (including memory, chat files)');
  } catch (e) {
    console.error('❌ Clear failed:', e.message);
  }
}

/**
 * Debounced save: prevent frequent disk writes
 */
let saveTimer = null;
export function debouncedSave(company, delay = 2000) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState(company);
    saveTimer = null;
  }, delay);
}
