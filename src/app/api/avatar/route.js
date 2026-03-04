import { NextResponse } from 'next/server';

/**
 * Avatar Proxy API
 * 代理 DiceBear Micah 头像请求，支持传递详细外观参数
 * 
 * 基础用法: /api/avatar?style=micah&seed=xxx
 * 详细参数: /api/avatar?style=micah&seed=xxx&hair=fonze&hairColor=000000&facialHair=beard...
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const style = searchParams.get('style') || 'micah';
  const seed = searchParams.get('seed') || 'default';

  // 构建 DiceBear URL，传递所有 Micah 参数
  let url = `https://api.dicebear.com/7.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;
  
  // DiceBear 7.x Micah 参数值白名单（防止无效值导致 400 错误）
  const VALID_VALUES = {
    hair: ['fonze', 'mrT', 'dougFunny', 'mrClean', 'dannyPhantom', 'full', 'pixie'],
    facialHair: ['beard', 'scruff'],
    earrings: ['hoop', 'stud'],
    glasses: ['round', 'square'],
    mouth: ['smile', 'laughing', 'nervous', 'pucker', 'sad', 'smirk', 'surprised', 'frown'],
    eyes: ['eyes', 'round', 'smiling', 'eyesShadow'],
    eyebrows: ['up', 'down', 'eyelashesUp', 'eyelashesDown'],
  };

  // 转发所有 Micah 外观参数（含值校验）
  const micahParams = [
    'hair', 'hairColor', 'facialHair', 'earrings', 'glasses',
    'mouth', 'eyes', 'eyebrows', 'baseColor', 'shirtColor',
  ];
  for (const param of micahParams) {
    const val = searchParams.get(param);
    if (!val) continue;
    // 对有白名单的参数做校验，颜色参数（hairColor/baseColor/shirtColor）直接放行
    if (VALID_VALUES[param] && !VALID_VALUES[param].includes(val)) continue;
    url += `&${param}=${encodeURIComponent(val)}`;
  }

  // 转发 probability 控制参数（0-100 整数，控制对应元素是否出现）
  const probParams = ['facialHairProbability', 'earringsProbability', 'glassesProbability'];
  for (const param of probParams) {
    const val = searchParams.get(param);
    if (val !== null && val !== undefined) {
      const num = parseInt(val, 10);
      if (!isNaN(num) && num >= 0 && num <= 100) {
        url += `&${param}=${num}`;
      }
    }
  }

  try {
    const resp = await fetch(url, {
      headers: { 'Accept': 'image/svg+xml' },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return generateFallbackAvatar(seed, style);
    }

    const svg = await resp.text();
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return generateFallbackAvatar(seed, style);
  }
}

/**
 * 外部 API 不可用时，生成简单的本地 SVG 头像
 */
function generateFallbackAvatar(seed, style) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  const saturation = 60 + (Math.abs(hash >> 8) % 30);
  const lightness = 40 + (Math.abs(hash >> 16) % 20);

  const initial = seed.charAt(0).toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="50" fill="hsl(${hue}, ${saturation}%, ${lightness}%)"/>
    <text x="50" y="50" text-anchor="middle" dominant-baseline="central" 
          font-size="42" font-family="sans-serif" fill="white" font-weight="bold">
      ${initial}
    </text>
  </svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
