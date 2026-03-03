/**
 * 生成头像 URL 的统一工具
 * 服务端（core/agent.js）和客户端（组件）都使用此函数
 * 
 * 在浏览器端走本地代理 /api/avatar，在服务端直连 DiceBear
 */

const AVATAR_STYLES = [
  'adventurer', 'avataaars', 'big-ears', 'bottts', 'croodles',
  'fun-emoji', 'icons', 'identicon', 'lorelei', 'micah',
  'miniavs', 'notionists', 'open-peeps', 'personas', 'pixel-art',
  'shapes', 'thumbs',
];

/**
 * 生成头像 URL
 * @param {string} seed - 种子（通常是名字）
 * @param {string} style - DiceBear 风格
 * @returns {string} 头像 URL
 */
export function getAvatarUrl(seed, style = 'bottts') {
  const encodedSeed = encodeURIComponent(seed);
  // 始终使用本地代理，保证浏览器能加载
  return `/api/avatar?style=${encodeURIComponent(style)}&seed=${encodedSeed}`;
}

/**
 * 从已有的外部 DiceBear URL 转换为本地代理 URL
 * @param {string} url - 可能是外部 DiceBear URL 或本地代理 URL
 * @returns {string} 本地代理 URL
 */
export function normalizeAvatarUrl(url) {
  if (!url) return getAvatarUrl('default');
  // 已经是本地代理 URL
  if (url.startsWith('/api/avatar')) return url;
  // 外部 DiceBear URL → 转换为本地代理
  const match = url.match(/dicebear\.com\/\d+\.x\/([^/]+)\/svg\?seed=(.+)/);
  if (match) {
    return getAvatarUrl(decodeURIComponent(match[2]), match[1]);
  }
  return url;
}

export { AVATAR_STYLES };
