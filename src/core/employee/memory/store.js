/**
 * Independent Memory File Management Module
 * 
 * Each Employee's memory is stored in a separate JSON file (data/memories/{employeeId}.json),
 * preventing all memories from being stuffed into company-state.json causing file bloat.
 * 
 * Workflow:
 * 1. When saving company state, memory only serializes a summary (counts); full memory goes to separate files
 * 2. When restoring company state, load each Employee's full memory from separate files
 * 3. When memory changes, save only that Employee's memory file (no need to rewrite entire company state)
 */
import fs from 'fs';
import path from 'path';
import { MEMORY_DIR } from '../../../lib/paths.js';

// Ensure directory exists
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

/**
 * Save a single Employee's memory to a separate file
 * @param {string} agentId - Employee ID
 * @param {object} memoryData - Serialized memory data { shortTerm, longTerm }
 * @param {object} meta - Metadata { name, role, department }
 */
export function saveAgentMemory(agentId, memoryData, meta = {}) {
  if (!agentId || !memoryData) return;
  try {
    const filePath = path.join(MEMORY_DIR, `${agentId}.json`);
    const data = {
      agentId,
      name: meta.name || 'unknown',
      role: meta.role || 'unknown',
      department: meta.department || 'unknown',
      shortTerm: memoryData.shortTerm || [],
      longTerm: memoryData.longTerm || [],
      historySummary: memoryData.historySummary || {},
      relationships: memoryData.relationships || {},
      stamina: meta.stamina || null,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`❌ Failed to save memory [${agentId}]:`, e.message);
  }
}

/**
 * Load a single Employee's memory
 * @param {string} agentId - Employee ID
 * @returns {object|null} { shortTerm, longTerm } or null
 */
export function loadAgentMemory(agentId) {
  if (!agentId) return null;
  try {
    const filePath = path.join(MEMORY_DIR, `${agentId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const json = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(json);
    return {
      shortTerm: data.shortTerm || [],
      longTerm: data.longTerm || [],
      historySummary: data.historySummary || {},
      relationships: data.relationships || {},
      stamina: data.stamina || null,
    };
  } catch (e) {
    console.error(`❌ Failed to load memory [${agentId}]:`, e.message);
    return null;
  }
}

/**
 * Batch save multiple Employees' memories
 * @param {Array<{agentId, memoryData, meta}>} agents - Employee memory array
 */
export function saveAllAgentMemories(agents) {
  let saved = 0;
  for (const { agentId, memoryData, meta } of agents) {
    saveAgentMemory(agentId, memoryData, meta);
    saved++;
  }
  if (saved > 0) {
    console.log(`🧠 Saved ${saved} Employee memory files`);
  }
}

/**
 * Delete an Employee's memory file
 * @param {string} agentId - Employee ID
 */
export function deleteAgentMemory(agentId) {
  try {
    const filePath = path.join(MEMORY_DIR, `${agentId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted Employee [${agentId}] memory file`);
    }
  } catch (e) {
    console.error(`❌ Failed to delete memory file [${agentId}]:`, e.message);
  }
}

/**
 * List all saved memory files
 * @returns {Array<{agentId, name, role, shortTermCount, longTermCount, savedAt}>}
 */
export function listMemoryFiles() {
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        const json = fs.readFileSync(path.join(MEMORY_DIR, f), 'utf-8');
        const data = JSON.parse(json);
        return {
          agentId: data.agentId,
          name: data.name,
          role: data.role,
          department: data.department,
          shortTermCount: data.shortTerm?.length || 0,
          longTermCount: data.longTerm?.length || 0,
          savedAt: data.savedAt,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Clear all memory files
 */
export function clearAllMemories() {
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json'));
    files.forEach(f => fs.unlinkSync(path.join(MEMORY_DIR, f)));
    console.log(`🗑️ Cleared ${files.length} memory files`);
  } catch (e) {
    console.error('❌ Failed to clear memory files:', e.message);
  }
}
