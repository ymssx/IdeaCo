'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * 全局内存缓存：url → dataURL / blob URL
 * 避免组件重新挂载时重复请求头像，消除闪动
 */
const avatarCache = new Map();
const pendingRequests = new Map();

function loadAvatar(src) {
  if (avatarCache.has(src)) return Promise.resolve(avatarCache.get(src));
  if (pendingRequests.has(src)) return pendingRequests.get(src);

  const promise = fetch(src)
    .then(res => res.blob())
    .then(blob => {
      const objectUrl = URL.createObjectURL(blob);
      avatarCache.set(src, objectUrl);
      pendingRequests.delete(src);
      return objectUrl;
    })
    .catch(() => {
      pendingRequests.delete(src);
      return src; // fallback to original URL
    });

  pendingRequests.set(src, promise);
  return promise;
}

/**
 * CachedAvatar - 带内存缓存的头像组件
 * 首次加载后缓存为 blob URL，后续渲染零闪动
 */
export default function CachedAvatar({ src, alt, className, title, onClick, style }) {
  const [cachedSrc, setCachedSrc] = useState(() => avatarCache.get(src) || null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!src) return;

    // 已缓存，直接使用
    const cached = avatarCache.get(src);
    if (cached) {
      setCachedSrc(cached);
      return;
    }

    // 加载并缓存
    loadAvatar(src).then(url => {
      if (mountedRef.current) setCachedSrc(url);
    });

    return () => { mountedRef.current = false; };
  }, [src]);

  // 缓存命中时直接渲染，无闪动
  if (cachedSrc) {
    return <img src={cachedSrc} alt={alt || ''} className={className} title={title} onClick={onClick} style={style} />;
  }

  // 首次加载：先显示背景占位，img 隐藏加载完后淡入
  return (
    <img
      src={src}
      alt={alt || ''}
      className={className}
      title={title}
      onClick={onClick}
      style={{ ...style, opacity: 0, transition: 'opacity 0.2s ease-in' }}
      onLoad={e => { e.target.style.opacity = 1; }}
    />
  );
}
