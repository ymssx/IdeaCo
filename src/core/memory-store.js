/**
 * 记忆独立文件管理模块
 * 
 * 每个 Agent 的记忆存储在独立的 JSON 文件中（data/memories/{agentId}.json），
 * 避免所有记忆都塞进 company-state.json 导致文件过大。
 * 
 * 工作流程：
 * 1. 保存公司状态时，memory 只序列化摘要（条数），完整记忆写入独立文件
 * 2. 恢复公司状态时，从独立文件加载每个 Agent 的完整记忆
 * 3. 记忆变化时，单独保存该 Agent 的记忆文件（无需重写整个公司状态）
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MEMORY_DIR = path.join(DATA_DIR, 'memories');

// 确保目录存在
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

/**
 * 保存单个 Agent 的记忆到独立文件
 * @param {string} agentId - Agent ID
 * @param {object} memoryData - 记忆序列化数据 { shortTerm, longTerm }
 * @param {object} meta - 元信息 { name, role, department }
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
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`❌ 保存记忆失败 [${agentId}]:`, e.message);
  }
}

/**
 * 加载单个 Agent 的记忆
 * @param {string} agentId - Agent ID
 * @returns {object|null} { shortTerm, longTerm } 或 null
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
    };
  } catch (e) {
    console.error(`❌ 加载记忆失败 [${agentId}]:`, e.message);
    return null;
  }
}

/**
 * 批量保存多个 Agent 的记忆
 * @param {Array<{agentId, memoryData, meta}>} agents - Agent 记忆数组
 */
export function saveAllAgentMemories(agents) {
  let saved = 0;
  for (const { agentId, memoryData, meta } of agents) {
    saveAgentMemory(agentId, memoryData, meta);
    saved++;
  }
  if (saved > 0) {
    console.log(`🧠 已保存 ${saved} 个 Agent 的独立记忆文件`);
  }
}

/**
 * 删除 Agent 记忆文件（解聘进入人才市场时不删除，保留历史记忆）
 * @param {string} agentId - Agent ID
 */
export function deleteAgentMemory(agentId) {
  try {
    const filePath = path.join(MEMORY_DIR, `${agentId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ 已删除 Agent [${agentId}] 的记忆文件`);
    }
  } catch (e) {
    console.error(`❌ 删除记忆文件失败 [${agentId}]:`, e.message);
  }
}

/**
 * 列出所有已保存的记忆文件
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
 * 清除所有记忆文件
 */
export function clearAllMemories() {
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json'));
    files.forEach(f => fs.unlinkSync(path.join(MEMORY_DIR, f)));
    console.log(`🗑️ 已清除 ${files.length} 个记忆文件`);
  } catch (e) {
    console.error('❌ 清除记忆文件失败:', e.message);
  }
}
