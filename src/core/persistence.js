/**
 * 持久化存储模块
 * 
 * 将 Company 的完整状态序列化到磁盘（JSON），服务器重启后自动恢复。
 * 存储位置：项目根目录 data/ 下。
 */
import fs from 'fs';
import path from 'path';
import { saveAllAgentMemories, loadAgentMemory, clearAllMemories } from './memory-store.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'company-state.json');
const BACKUP_FILE = path.join(DATA_DIR, 'company-state.backup.json');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 保存公司状态到磁盘
 * @param {Company} company - 公司实例
 */
export function saveState(company) {
  if (!company) return;
  try {
    // 收集所有 Agent 的记忆，保存到独立文件
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
    // 秘书的记忆也独立保存
    if (company.secretary?.agent) {
      agentMemories.push({
        agentId: company.secretary.agent.id,
        memoryData: company.secretary.agent.memory.serialize(),
        meta: { name: company.secretary.agent.name, role: '专属秘书', department: '总部' },
      });
    }
    saveAllAgentMemories(agentMemories);

    const serialized = company.serialize();
    const json = JSON.stringify(serialized, null, 2);

    // 先备份旧文件
    if (fs.existsSync(STATE_FILE)) {
      fs.copyFileSync(STATE_FILE, BACKUP_FILE);
    }

    // 写入新状态
    fs.writeFileSync(STATE_FILE, json, 'utf-8');
    console.log(`💾 状态已持久化 (${(json.length / 1024).toFixed(1)}KB)`);
  } catch (e) {
    console.error('❌ 持久化失败:', e.message);
  }
}

/**
 * 从磁盘加载公司状态
 * @returns {object|null} 序列化的状态数据，或 null
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
    console.log(`📂 从磁盘加载状态: ${data.name || 'unknown'}`);
    return data;
  } catch (e) {
    console.error('❌ 加载状态失败:', e.message);
    return null;
  }
}

/**
 * 删除持久化数据（重置）
 */
export function clearState() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    clearAllMemories();
    console.log('🗑️ 持久化数据已清除（含独立记忆文件）');
  } catch (e) {
    console.error('❌ 清除失败:', e.message);
  }
}

/**
 * 防抖保存：避免频繁写入磁盘
 */
let saveTimer = null;
export function debouncedSave(company, delay = 2000) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState(company);
    saveTimer = null;
  }, delay);
}
