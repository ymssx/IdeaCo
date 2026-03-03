/**
 * 全局状态管理 - 服务端单例
 * 在 Next.js API Routes 中共享 Company 实例
 * 
 * 持久化：
 * - 启动时自动从 data/company-state.json 恢复
 * - 状态变更时自动保存到磁盘
 * - 使用 globalThis 防止 hot reload 时状态丢失
 */
import { loadState, saveState, clearState } from '@/core/persistence.js';
import { Company } from '@/core/index.js';

const globalStore = globalThis;

if (!globalStore.__aiEnterprise) {
  globalStore.__aiEnterprise = {
    company: null,
    loaded: false,
  };

  // 首次启动时尝试从磁盘恢复
  try {
    const savedData = loadState();
    if (savedData) {
      globalStore.__aiEnterprise.company = Company.deserialize(savedData);
      console.log('🔄 从磁盘恢复公司状态成功');
    }
  } catch (e) {
    console.error('⚠️ 恢复状态失败，将以空状态启动:', e.message);
    globalStore.__aiEnterprise.company = null;
  }
  globalStore.__aiEnterprise.loaded = true;
}

export function getCompany() {
  return globalStore.__aiEnterprise.company;
}

export function setCompany(company) {
  globalStore.__aiEnterprise.company = company;
  // 立即保存到磁盘
  if (company) {
    saveState(company);
  }
}

export function resetCompany() {
  globalStore.__aiEnterprise.company = null;
  clearState();
}
