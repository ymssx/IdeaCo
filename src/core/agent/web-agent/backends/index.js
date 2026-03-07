/**
 * Web Backends 模块入口
 *
 * 管理所有 web 后端（ChatGPT、Claude、DeepSeek 等）。
 * 每个后端有自己的文件夹，包含配置（config.js）、DOM 脚本（dom-scripts.js）和客户端（client.js）。
 *
 * 目录结构:
 * backends/
 * ├── index.js           - 本文件，模块入口
 * ├── base-backend.js    - Web 后端基类
 * └── chatgpt/
 *     ├── config.js      - ChatGPT 站点配置和选择器
 *     ├── dom-scripts.js - ChatGPT DOM 交互脚本
 *     └── client.js      - ChatGPTBackend 类
 *
 * 扩展新后端（如 Claude、DeepSeek）:
 * 1. 新建 backends/claude/ 文件夹
 * 2. 创建 config.js（站点 URL、选择器）、dom-scripts.js（DOM 脚本）、client.js（后端类）
 * 3. 在此文件中注册新后端
 */

import { BaseWebBackend } from './base-backend.js';
import { chatgptBackend } from './chatgpt/client.js';

/**
 * Web 后端注册表
 * 通过 backendId 查找对应的后端实例。
 */
class WebBackendRegistry {
  constructor() {
    /** @type {Map<string, BaseWebBackend>} */
    this._backends = new Map();
  }

  /**
   * 注册一个后端
   * @param {BaseWebBackend} backend
   */
  register(backend) {
    this._backends.set(backend.id, backend);
  }

  /**
   * 根据 backendId 获取后端
   * @param {string} backendId - 如 'chatgpt', 'claude', 'deepseek'
   * @returns {BaseWebBackend|null}
   */
  get(backendId) {
    return this._backends.get(backendId) || null;
  }

  /**
   * 根据 providerId 获取后端（兼容旧的 provider 命名，如 'web-chatgpt-xxx'）
   * @param {string} providerId
   * @returns {BaseWebBackend|null}
   */
  getByProviderId(providerId) {
    if (!providerId) return null;
    // 尝试精确匹配
    for (const [id, backend] of this._backends) {
      if (providerId === id || providerId.includes(id)) {
        return backend;
      }
    }
    return null;
  }

  /**
   * 获取所有已注册的后端
   * @returns {BaseWebBackend[]}
   */
  getAll() {
    return Array.from(this._backends.values());
  }

  /**
   * 获取所有后端 ID
   * @returns {string[]}
   */
  getAllIds() {
    return Array.from(this._backends.keys());
  }
}

// 创建全局注册表单例并注册内置后端
export const webBackendRegistry = new WebBackendRegistry();
webBackendRegistry.register(chatgptBackend);

// 导出
export { BaseWebBackend } from './base-backend.js';
export { ChatGPTBackend, chatgptBackend } from './chatgpt/client.js';
