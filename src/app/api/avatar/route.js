import { NextResponse } from 'next/server';

/**
 * 头像代理 API
 * 将 DiceBear 的外部 SVG 请求代理到本地，避免浏览器因网络问题无法加载外部头像
 * 
 * 用法: /api/avatar?style=bottts&seed=小秘
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const style = searchParams.get('style') || 'bottts';
  const seed = searchParams.get('seed') || 'default';

  const url = `https://api.dicebear.com/7.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;

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
    // 网络不可用时，生成一个简单的本地 SVG 头像作为 fallback
    return generateFallbackAvatar(seed, style);
  }
}

/**
 * 当外部 API 不可用时，生成一个简单的本地 SVG 头像
 */
function generateFallbackAvatar(seed, style) {
  // 用 seed 生成一个确定性的颜色
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  const saturation = 60 + (Math.abs(hash >> 8) % 30);
  const lightness = 40 + (Math.abs(hash >> 16) % 20);

  // 取 seed 的第一个字符作为显示文字
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
