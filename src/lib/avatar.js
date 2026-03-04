/**
 * 统一头像 URL 生成工具
 * 全部使用 DiceBear Micah 风格
 * 
 * 核心逻辑：通过性别+年龄控制 Micah 头像的具体外观参数（发型、胡子、耳环等）
 * 每个头像 = 性别参数 + 年龄参数 + 随机种子 → 唯一外观
 * 不再用"同一名字 = 同一头像"，而是随机生成后记录在 Agent 个人信息中
 */

// ========================
// Micah 风格可用参数选项
// ========================

// 发型（长短、形状）
// DiceBear 7.x Micah 有效发型: fonze, mrT, dougFunny, mrClean, dannyPhantom, full, pixie
// fonze: 复古后梳（偏男性）, mrT: 莫西干（男性）, dougFunny: 短发（中性）, mrClean: 光头（男性）
// dannyPhantom: 中长尖发（中性）, full: 蓬松长发（女性）, pixie: 精灵短发（女性）
const HAIR_STYLES = {
  female: ['full', 'full', 'pixie', 'pixie', 'dannyPhantom', 'dougFunny'],  // 女性：长发和精灵短发权重更高，绝对无光头/莫西干/复古
  male: ['fonze', 'mrT', 'dougFunny', 'mrClean', 'dannyPhantom', 'full'],  // 男性：各种发型
};

// 面部毛发（仅男性）
// DiceBear 7.x Micah 有效值: beard, scruff
// 重要：DiceBear 默认会随机画胡子，女性必须通过 facialHairProbability=0 显式禁止
const FACIAL_HAIR = {
  female: [], // 女性绝对无胡子（通过 facialHairProbability=0 强制禁止）
  male: ['beard', 'scruff'], // 男性可选胡型
};

// 耳环
const EARRINGS = {
  female: ['', 'hoop', 'stud'],
  male: ['', 'stud'], // 男性少量耳环
};

// 眼镜
const GLASSES = ['', 'round', 'square'];

// 嘴型
const MOUTH = ['smile', 'laughing', 'nervous', 'pucker', 'sad', 'smirk', 'surprised', 'frown'];

// 眼睛
// DiceBear 7.x Micah 有效值: eyes, round, smiling, eyesShadow（wink 无效！）
const EYES = ['eyes', 'round', 'smiling', 'eyesShadow'];

// 眉毛
const EYEBROWS = ['up', 'down', 'eyelashesUp', 'eyelashesDown'];

// 衬衫颜色
const SHIRT_COLORS = ['6bd9e9', '9287ff', 'fc909f', 'fc6681', 'ffeba4', 'ffc6a0', '77311d'];

// 头发颜色
const HAIR_COLORS = {
  young: ['000000', '77311d', 'fc909f', 'ffc6a0', 'cabfad', 'd2eff3', '6bd9e9', '9287ff'],
  middle: ['000000', '77311d', 'cabfad', 'ffc6a0', 'fc909f'],
  older: ['000000', '77311d', 'cabfad', 'ffc6a0'],
};

// 基础肤色
const BASE_COLORS = ['ac6651', 'd9b191', 'e0ddff', 'f4d150', 'ffeba4', 'ffedef'];

/**
 * 根据性别和年龄的范围分类
 */
function getAgeGroup(age) {
  if (age <= 25) return 'young';
  if (age <= 40) return 'middle';
  return 'older';
}

/**
 * 伪随机数生成器（基于种子，确保同一种子总是产生相同结果）
 */
function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = seed.charCodeAt(i) + ((s << 5) - s);
  }
  return function() {
    s = (s * 16807 + 0) % 2147483647;
    return (s & 0x7fffffff) / 2147483647;
  };
}

/**
 * 从数组中随机选一个
 */
function pick(arr, rng) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * 根据性别、年龄和随机种子，生成 Micah 头像的参数对象
 * @param {'male'|'female'} gender
 * @param {number} age
 * @param {string} randomSeed - 随机种子字符串
 * @returns {object} Micah 参数对象
 */
export function generateAvatarParams(gender, age, randomSeed) {
  const g = gender === 'female' ? 'female' : 'male';
  const ageGroup = getAgeGroup(age || 25);
  const rng = seededRandom(randomSeed || Math.random().toString());

  // 发型
  const hair = pick(HAIR_STYLES[g], rng);
  // 头发颜色（年轻人更多彩）
  const hairColor = pick(HAIR_COLORS[ageGroup], rng);
  // 面部毛发
  let facialHair = '';
  let facialHairProbability = 0; // 默认禁止胡子（女性）
  if (g === 'male') {
    // 年龄越大越可能有胡子
    const beardChance = ageGroup === 'young' ? 0.15 : ageGroup === 'middle' ? 0.4 : 0.6;
    if (rng() < beardChance) {
      facialHair = pick(FACIAL_HAIR.male, rng);
      facialHairProbability = 100; // 确定有胡子
    }
    // 男性不要胡子时也需要显式设为 0，防止 DiceBear 默认随机生成
  }
  // 耳环（通过 probability 控制有无）
  let earrings = '';
  let earringsProbability = 0;
  const earringChance = g === 'female' ? 0.6 : 0.15;
  if (rng() < earringChance) {
    earrings = pick(EARRINGS[g].filter(x => x), rng);
    earringsProbability = 100;
  }
  // 眼镜（年龄越大越可能戴眼镜，通过 probability 控制）
  let glasses = '';
  let glassesProbability = 0;
  const glassesChance = ageGroup === 'young' ? 0.15 : ageGroup === 'middle' ? 0.3 : 0.5;
  if (rng() < glassesChance) {
    glasses = pick(GLASSES.filter(x => x), rng);
    glassesProbability = 100;
  }
  // 表情
  const mouth = pick(MOUTH, rng);
  const eyes = pick(EYES, rng);
  const eyebrows = pick(EYEBROWS, rng);
  // 衣服
  const shirtColor = pick(SHIRT_COLORS, rng);
  // 肤色
  const baseColor = pick(BASE_COLORS, rng);

  return {
    hair,
    hairColor,
    facialHair,
    facialHairProbability,
    earrings,
    earringsProbability,
    glasses,
    glassesProbability,
    mouth,
    eyes,
    eyebrows,
    shirtColor,
    baseColor,
    // 保存原始参数，方便序列化
    _gender: g,
    _age: age,
    _seed: randomSeed,
  };
}

/**
 * 将参数对象转换为 DiceBear URL query string
 */
function paramsToQuery(params) {
  const parts = [];
  if (params.hair) parts.push(`hair=${params.hair}`);
  if (params.hairColor) parts.push(`hairColor=${params.hairColor}`);
  // 胡子：必须始终传 facialHairProbability 来控制有无（DiceBear 默认会随机画胡子）
  if (params.facialHair) parts.push(`facialHair=${params.facialHair}`);
  parts.push(`facialHairProbability=${params.facialHairProbability ?? 0}`);
  // 耳环：通过 probability 控制
  if (params.earrings) parts.push(`earrings=${params.earrings}`);
  parts.push(`earringsProbability=${params.earringsProbability ?? 0}`);
  // 眼镜：通过 probability 控制
  if (params.glasses) parts.push(`glasses=${params.glasses}`);
  parts.push(`glassesProbability=${params.glassesProbability ?? 0}`);
  if (params.mouth) parts.push(`mouth=${params.mouth}`);
  if (params.eyes) parts.push(`eyes=${params.eyes}`);
  if (params.eyebrows) parts.push(`eyebrows=${params.eyebrows}`);
  if (params.shirtColor) parts.push(`shirtColor=${params.shirtColor}`);
  if (params.baseColor) parts.push(`baseColor=${params.baseColor}`);
  return parts.join('&');
}

/**
 * 生成头像 URL（本地代理）
 * @param {object} params - 由 generateAvatarParams 生成的参数对象
 * @returns {string} URL
 */
export function getAvatarUrlFromParams(params) {
  // 使用种子 + 参数组合，确保唯一性
  const seed = params._seed || 'default';
  const query = paramsToQuery(params);
  return `/api/avatar?style=micah&seed=${encodeURIComponent(seed)}${query ? '&' + query : ''}`;
}

/**
 * 简单的 getAvatarUrl（向后兼容，传入 seed 和可选的 style）
 * 新版推荐使用 getAvatarUrlFromParams
 */
export function getAvatarUrl(seed, style) {
  return `/api/avatar?style=micah&seed=${encodeURIComponent(seed || 'default')}`;
}

/**
 * 为新 Agent 生成完整的头像信息
 * @param {'male'|'female'} gender
 * @param {number} age
 * @returns {{ url: string, params: object }}
 */
export function generateAgentAvatar(gender, age) {
  // 随机种子：确保每次调用都不同
  const randomSeed = `${gender}-${age}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const params = generateAvatarParams(gender, age, randomSeed);
  return {
    url: getAvatarUrlFromParams(params),
    params,
  };
}

/**
 * 获取一批供选择的头像
 * @param {number} count - 数量
 * @param {'male'|'female'} gender - 性别
 * @param {number} age - 年龄
 * @returns {Array<{url: string, params: object, id: string}>}
 */
export function getAvatarChoices(count = 16, gender = 'female', age = 25) {
  const choices = [];
  for (let i = 0; i < count; i++) {
    const seed = `choice-${gender}-${age}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    const params = generateAvatarParams(gender, age, seed);
    choices.push({
      id: seed,
      url: getAvatarUrlFromParams(params),
      params,
    });
  }
  return choices;
}

/**
 * 从已有的头像 URL 中还原参数（有限度的）
 * 主要用于向后兼容旧数据
 */
export function normalizeAvatarUrl(url) {
  if (!url) return getAvatarUrl('default');
  if (url.startsWith('/api/avatar')) return url;
  // 外部 DiceBear URL → 转换为本地代理
  const match = url.match(/dicebear\.com\/\d+\.x\/([^/]+)\/svg\?seed=(.+)/);
  if (match) {
    return getAvatarUrl(decodeURIComponent(match[2]));
  }
  return url;
}

// 向后兼容导出
const AVATAR_STYLE = 'micah';
const AVATAR_STYLES = ['micah'];

export { AVATAR_STYLE, AVATAR_STYLES };
