/**
 * Unified avatar URL generator
 * All avatars use DiceBear Micah style
 * 
 * Core logic: controls Micah avatar appearance parameters (hair, beard, earrings, etc.) via gender+age
 * Each avatar = gender params + age params + random seed → unique appearance
 * No longer uses "same name = same avatar"; instead generates randomly and stores in Agent profile
 */

// ========================
// Micah style available parameter options
// ========================

// Hairstyles (length, shape)
// DiceBear 7.x Micah valid hairstyles: fonze, mrT, dougFunny, mrClean, dannyPhantom, full, pixie
// fonze: retro pompadour (male), mrT: mohawk (male), dougFunny: short (neutral), mrClean: bald (male)
// dannyPhantom: medium-long spiky (neutral), full: voluminous long hair (female), pixie: elf short hair (female)
const HAIR_STYLES = {
  female: ['full', 'full', 'pixie', 'pixie', 'dannyPhantom', 'dougFunny'],  // Female: longer hair and pixie weighted higher, absolutely no bald/mohawk/pompadour
  male: ['fonze', 'mrT', 'dougFunny', 'mrClean', 'dannyPhantom', 'full'],  // Male: various hairstyles
};

// Facial hair (male only)
// DiceBear 7.x Micah valid values: beard, scruff
// Important: DiceBear randomly draws facial hair by default; females must explicitly disable via facialHairProbability=0
const FACIAL_HAIR = {
  female: [], // Female absolutely no beard (forced disabled via facialHairProbability=0)
  male: ['beard', 'scruff'], // Male optional beard types
};

// Earrings
const EARRINGS = {
  female: ['', 'hoop', 'stud'],
  male: ['', 'stud'], // Male minimal earrings
};

// Glasses
const GLASSES = ['', 'round', 'square'];

// Mouth shape
const MOUTH = ['smile', 'laughing', 'nervous', 'pucker', 'sad', 'smirk', 'surprised', 'frown'];

// Eyes
// DiceBear 7.x Micah valid values: eyes, round, smiling, eyesShadow (wink is invalid!)
const EYES = ['eyes', 'round', 'smiling', 'eyesShadow'];

// Eyebrows
const EYEBROWS = ['up', 'down', 'eyelashesUp', 'eyelashesDown'];

// Shirt color
const SHIRT_COLORS = ['6bd9e9', '9287ff', 'fc909f', 'fc6681', 'ffeba4', 'ffc6a0', '77311d'];

// Hair color
const HAIR_COLORS = {
  young: ['000000', '77311d', 'fc909f', 'ffc6a0', 'cabfad', 'd2eff3', '6bd9e9', '9287ff'],
  middle: ['000000', '77311d', 'cabfad', 'ffc6a0', 'fc909f'],
  older: ['000000', '77311d', 'cabfad', 'ffc6a0'],
};

// Base skin tones
const BASE_COLORS = ['ac6651', 'd9b191', 'e0ddff', 'f4d150', 'ffeba4', 'ffedef'];

/**
 * Categorize by gender and age range
 */
function getAgeGroup(age) {
  if (age <= 25) return 'young';
  if (age <= 40) return 'middle';
  return 'older';
}

/**
 * Pseudo-random number generator (seed-based, same seed always produces same result)
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
 * Randomly select one from an array
 */
function pick(arr, rng) {
  if (!arr || arr.length === 0) return '';
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate Micah avatar parameter object based on gender, age and random seed
 * @param {'male'|'female'} gender
 * @param {number} age
 * @param {string} randomSeed - Random seed string
 * @returns {object} Micah parameter object
 */
export function generateAvatarParams(gender, age, randomSeed) {
  const g = gender === 'female' ? 'female' : 'male';
  const ageGroup = getAgeGroup(age || 25);
  const rng = seededRandom(randomSeed || Math.random().toString());

  // Hairstyle
  const hair = pick(HAIR_STYLES[g], rng);
  // Hair color (younger people have more colorful options)
  const hairColor = pick(HAIR_COLORS[ageGroup], rng);
  // Facial hair
  let facialHair = '';
  let facialHairProbability = 0; // Default: disable beard (female)
  if (g === 'male') {
    // Older age = more likely to have beard
    const beardChance = ageGroup === 'young' ? 0.15 : ageGroup === 'middle' ? 0.4 : 0.6;
    if (rng() < beardChance) {
      facialHair = pick(FACIAL_HAIR.male, rng);
      facialHairProbability = 100; // Definitely has beard
    }
    // Even when male has no beard, explicitly set to 0 to prevent DiceBear from randomly generating one
  }
  // Earrings (controlled via probability)
  let earrings = '';
  let earringsProbability = 0;
  const earringChance = g === 'female' ? 0.6 : 0.15;
  if (rng() < earringChance) {
    earrings = pick(EARRINGS[g].filter(x => x), rng);
    earringsProbability = 100;
  }
  // Glasses (older age = more likely, controlled via probability)
  let glasses = '';
  let glassesProbability = 0;
  const glassesChance = ageGroup === 'young' ? 0.15 : ageGroup === 'middle' ? 0.3 : 0.5;
  if (rng() < glassesChance) {
    glasses = pick(GLASSES.filter(x => x), rng);
    glassesProbability = 100;
  }
  // Expression
  const mouth = pick(MOUTH, rng);
  const eyes = pick(EYES, rng);
  const eyebrows = pick(EYEBROWS, rng);
  // Clothes
  const shirtColor = pick(SHIRT_COLORS, rng);
  // Skin color
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
    // Save original params for serialization
    _gender: g,
    _age: age,
    _seed: randomSeed,
  };
}

/**
 * Convert parameter object to DiceBear URL query string
 */
function paramsToQuery(params) {
  const parts = [];
  if (params.hair) parts.push(`hair=${params.hair}`);
  if (params.hairColor) parts.push(`hairColor=${params.hairColor}`);
  // Beard: must always pass facialHairProbability to control presence (DiceBear randomly draws by default)
  if (params.facialHair) parts.push(`facialHair=${params.facialHair}`);
  parts.push(`facialHairProbability=${params.facialHairProbability ?? 0}`);
  // Earrings: controlled via probability
  if (params.earrings) parts.push(`earrings=${params.earrings}`);
  parts.push(`earringsProbability=${params.earringsProbability ?? 0}`);
  // Glasses: controlled via probability
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
 * Generate avatar URL (local proxy)
 * @param {object} params - Parameter object generated by generateAvatarParams
 * @returns {string} URL
 */
export function getAvatarUrlFromParams(params) {
  // Use seed + params combination to ensure uniqueness
  const seed = params._seed || 'default';
  const query = paramsToQuery(params);
  return `/api/avatar?style=micah&seed=${encodeURIComponent(seed)}${query ? '&' + query : ''}`;
}

/**
 * Simple getAvatarUrl (backward-compatible, takes seed and optional style)
 * New version recommends using getAvatarUrlFromParams
 */
export function getAvatarUrl(seed, style) {
  return `/api/avatar?style=micah&seed=${encodeURIComponent(seed || 'default')}`;
}

/**
 * Generate complete avatar info for a new Agent
 * @param {'male'|'female'} gender
 * @param {number} age
 * @returns {{ url: string, params: object }}
 */
export function generateAgentAvatar(gender, age) {
  // Random seed: ensures different result each call
  const randomSeed = `${gender}-${age}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const params = generateAvatarParams(gender, age, randomSeed);
  return {
    url: getAvatarUrlFromParams(params),
    params,
  };
}

/**
 * Get a batch of avatars to choose from
 * @param {number} count - Count
 * @param {'male'|'female'} gender - Gender
 * @param {number} age - Age
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
 * Restore parameters from an existing avatar URL (limited)
 * Mainly for backward compatibility with old data
 */
export function normalizeAvatarUrl(url) {
  if (!url) return getAvatarUrl('default');
  if (url.startsWith('/api/avatar')) return url;
  // External DiceBear URL → convert to local proxy
  const match = url.match(/dicebear\.com\/\d+\.x\/([^/]+)\/svg\?seed=(.+)/);
  if (match) {
    return getAvatarUrl(decodeURIComponent(match[2]));
  }
  return url;
}

// Backward-compatible exports
const AVATAR_STYLE = 'micah';
const AVATAR_STYLES = ['micah'];

export { AVATAR_STYLE, AVATAR_STYLES };
