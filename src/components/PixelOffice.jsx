'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import AgentDetailModal from '@/components/AgentDetailModal';

// ===== Pixel Art Color Palettes (Stardew Valley inspired) =====
const ROOM_PALETTES = [
  { floor: '#8B7355', wall: '#A0522D', wallTop: '#C4956A', accent: '#DEB887', name: 'wood' },
  { floor: '#6B8E6B', wall: '#2E5A2E', wallTop: '#5A8A5A', accent: '#90C090', name: 'garden' },
  { floor: '#7B7BA0', wall: '#3D3D6B', wallTop: '#6060A0', accent: '#9090D0', name: 'tech' },
  { floor: '#A07070', wall: '#6B2D2D', wallTop: '#905050', accent: '#D09090', name: 'warm' },
  { floor: '#70A0A0', wall: '#2D5A6B', wallTop: '#508090', accent: '#90C0D0', name: 'ocean' },
  { floor: '#A0A070', wall: '#5A5A2D', wallTop: '#808050', accent: '#C0C090', name: 'sand' },
  { floor: '#9070A0', wall: '#5A2D6B', wallTop: '#805090', accent: '#B090D0', name: 'violet' },
  { floor: '#A08870', wall: '#6B4A2D', wallTop: '#906A50', accent: '#D0B090', name: 'coffee' },
];

const SKIN_COLORS = ['#FFD5B8', '#E8B89A', '#C4956A', '#A07855', '#8B6544'];
const HAIR_COLORS = ['#2C1810', '#5A3520', '#8B4513', '#D4A574', '#E8C07A', '#C0392B', '#2C3E50', '#7D3C98', '#F39C12', '#ECF0F1'];
const SHIRT_COLORS = ['#3498DB', '#E74C3C', '#2ECC71', '#9B59B6', '#F39C12', '#1ABC9C', '#E67E22', '#34495E', '#E91E63', '#00BCD4'];

// ===== Hash helper =====
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getCharColors(name) {
  const h = hashStr(name);
  return {
    skin: SKIN_COLORS[h % SKIN_COLORS.length],
    hair: HAIR_COLORS[(h >> 3) % HAIR_COLORS.length],
    shirt: SHIRT_COLORS[(h >> 6) % SHIRT_COLORS.length],
    pants: ['#2C3E50', '#4A4A6A', '#3D5A3D', '#6B4A3D'][(h >> 9) % 4],
  };
}

// ===== Draw pixel character (higher detail) =====
function drawPixelChar(ctx, x, y, name, scale = 3, frame = 0, direction = 0, sitting = false) {
  const c = getCharColors(name);
  const s = scale;
  const px = (dx, dy, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + dx * s, y + dy * s, s, s);
  };

  // Hair (fuller)
  const hairDark = adjustColor(c.hair, -20);
  for (let i = -2; i <= 2; i++) px(i, -7, c.hair);
  for (let i = -2; i <= 2; i++) px(i, -6, c.hair);
  px(-3, -6, hairDark); px(3, -6, hairDark);
  px(-3, -5, c.hair); px(3, -5, c.hair);

  // Head
  for (let i = -2; i <= 2; i++) px(i, -5, c.skin);
  for (let i = -2; i <= 2; i++) px(i, -4, c.skin);
  for (let i = -2; i <= 2; i++) px(i, -3, c.skin);
  // Side hair
  px(-3, -5, c.hair); px(3, -5, c.hair);
  px(-3, -4, c.hair); px(3, -4, c.hair);

  // Eyes (blink)
  const blinkFrame = frame % 150;
  if (blinkFrame < 140) {
    px(direction >= 0 ? -1 : 0, -4, '#2C1810');
    px(direction <= 0 ? 1 : 0, -4, '#2C1810');
    // Eye shine
    px(direction >= 0 ? -1 : 0, -4, '#2C1810');
  } else {
    px(-1, -4, adjustColor(c.skin, -15));
    px(1, -4, adjustColor(c.skin, -15));
  }
  // Nose
  px(0, -3, adjustColor(c.skin, -10));
  // Mouth
  px(-1, -3, adjustColor(c.skin, -5));
  px(0, -3, adjustColor(c.skin, -12));
  px(1, -3, adjustColor(c.skin, -5));

  // Neck
  px(-1, -2, c.skin); px(0, -2, c.skin); px(1, -2, c.skin);

  // Collar
  const collarColor = adjustColor(c.shirt, 20);
  px(-2, -2, collarColor); px(2, -2, collarColor);

  // Torso / shirt (wider)
  for (let row = -1; row <= 1; row++) {
    for (let col = -3; col <= 3; col++) {
      px(col, row, c.shirt);
    }
  }
  // Shirt detail
  px(0, -1, adjustColor(c.shirt, -15)); // button line
  px(0, 0, adjustColor(c.shirt, -15));

  if (sitting) {
    // Arms resting on desk
    px(-4, 0, c.skin); px(-4, 1, c.skin);
    px(4, 0, c.skin); px(4, 1, c.skin);
    // Lower body hidden in chair
    for (let col = -2; col <= 2; col++) px(col, 2, c.pants);
  } else {
    // Arms (animate when walking)
    const armSwing = Math.floor(frame / 12) % 4;
    const armAnim = direction !== 0;
    if (armAnim) {
      const offL = armSwing < 2 ? 0 : 1;
      const offR = armSwing < 2 ? 1 : 0;
      px(-4, -1 + offL, c.skin); px(-4, offL, c.skin);
      px(4, -1 + offR, c.skin); px(4, offR, c.skin);
    } else {
      px(-4, 0, c.skin); px(-4, 1, c.skin);
      px(4, 0, c.skin); px(4, 1, c.skin);
    }

    // Belt
    for (let col = -3; col <= 3; col++) px(col, 2, adjustColor(c.pants, -10));
    px(0, 2, '#888'); // buckle

    // Legs
    const legFrame = direction !== 0 ? Math.floor(frame / 10) % 4 : 0;
    if (legFrame === 0 || legFrame === 2) {
      px(-2, 3, c.pants); px(-1, 3, c.pants);
      px(1, 3, c.pants); px(2, 3, c.pants);
      px(-2, 4, c.pants); px(-1, 4, c.pants);
      px(1, 4, c.pants); px(2, 4, c.pants);
    } else if (legFrame === 1) {
      px(-3, 3, c.pants); px(-2, 3, c.pants);
      px(1, 3, c.pants); px(2, 3, c.pants);
      px(-3, 4, c.pants); px(-2, 4, c.pants);
      px(1, 4, c.pants); px(2, 4, c.pants);
    } else {
      px(-2, 3, c.pants); px(-1, 3, c.pants);
      px(2, 3, c.pants); px(3, 3, c.pants);
      px(-2, 4, c.pants); px(-1, 4, c.pants);
      px(2, 4, c.pants); px(3, 4, c.pants);
    }

    // Shoes (detailed)
    px(-2, 5, '#1a1a1a'); px(-1, 5, '#1a1a1a');
    px(1, 5, '#1a1a1a'); px(2, 5, '#1a1a1a');
    px(-2, 5, '#222'); px(2, 5, '#222'); // sole highlight
  }
}

// Darken/lighten a hex color
function adjustColor(hex, amount) {
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ===== Draw chat bubble above character =====
function drawBubble(ctx, x, y, text, scale = 2) {
  if (!text) return;
  const maxChars = 20;
  const displayText = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;

  ctx.font = `${10 * (scale / 2)}px "Courier New", monospace`;
  const metrics = ctx.measureText(displayText);
  const tw = metrics.width;
  const bw = tw + 12 * (scale / 2);
  const bh = 18 * (scale / 2);
  const bx = x - bw / 2;
  const by = y - 6 * scale - bh - 4;

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = '#5A3520';
  ctx.lineWidth = scale / 2;
  roundRect(ctx, bx, by, bw, bh, 4 * (scale / 2));
  ctx.fill();
  ctx.stroke();

  // Triangle pointer
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(x - 3 * (scale / 2), by + bh);
  ctx.lineTo(x + 3 * (scale / 2), by + bh);
  ctx.lineTo(x, by + bh + 4 * (scale / 2));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5A3520';
  ctx.beginPath();
  ctx.moveTo(x - 3 * (scale / 2), by + bh);
  ctx.lineTo(x, by + bh + 4 * (scale / 2));
  ctx.lineTo(x + 3 * (scale / 2), by + bh);
  ctx.stroke();

  ctx.fillStyle = '#2C1810';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayText, x, by + bh / 2);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ===== Furniture Drawing Functions =====
function drawDesk(ctx, x, y, s) {
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x, y, 12 * s, 6 * s);
  ctx.fillStyle = '#A07828';
  ctx.fillRect(x + s, y + s, 10 * s, 4 * s);
  // monitor
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 3 * s, y - 5 * s, 6 * s, 5 * s);
  ctx.fillStyle = '#4488AA';
  ctx.fillRect(x + 4 * s, y - 4 * s, 4 * s, 3 * s);
  // monitor stand
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 5 * s, y, 2 * s, s);
}

function drawPlant(ctx, x, y, s) {
  ctx.fillStyle = '#A0522D';
  ctx.fillRect(x, y, 4 * s, 4 * s);
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x - s, y, 6 * s, s);
  ctx.fillStyle = '#228B22';
  ctx.fillRect(x - s, y - 4 * s, 6 * s, 4 * s);
  ctx.fillStyle = '#32CD32';
  ctx.fillRect(x, y - 5 * s, 4 * s, 2 * s);
  ctx.fillRect(x - 2 * s, y - 3 * s, 2 * s, 2 * s);
  ctx.fillRect(x + 4 * s, y - 2 * s, 2 * s, 2 * s);
}

function drawSmallPlant(ctx, x, y, s) {
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x, y, 3 * s, 3 * s);
  ctx.fillStyle = '#228B22';
  ctx.fillRect(x - s, y - 3 * s, 5 * s, 3 * s);
  ctx.fillStyle = '#32CD32';
  ctx.fillRect(x, y - 4 * s, 3 * s, 2 * s);
}

function drawWaterCooler(ctx, x, y, s) {
  ctx.fillStyle = '#B0C4DE';
  ctx.fillRect(x, y - 6 * s, 4 * s, 6 * s);
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(x + s, y - 5 * s, 2 * s, 3 * s);
  ctx.fillStyle = '#666';
  ctx.fillRect(x, y, 4 * s, 2 * s);
}

function drawBookshelf(ctx, x, y, s) {
  ctx.fillStyle = '#6B4226';
  ctx.fillRect(x, y - 10 * s, 10 * s, 12 * s);
  ctx.fillStyle = '#8B5A2B';
  ctx.fillRect(x + s, y - 9 * s, 8 * s, 3 * s);
  ctx.fillRect(x + s, y - 5 * s, 8 * s, 3 * s);
  ctx.fillRect(x + s, y - 1 * s, 8 * s, 2 * s);
  const bookColors = ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6', '#E67E22'];
  for (let row = 0; row < 3; row++) {
    const rowY = y - 9 * s + row * 4 * s;
    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = bookColors[(row * 4 + b) % bookColors.length];
      ctx.fillRect(x + (s + b * 2 * s), rowY, s, 2.5 * s);
    }
  }
}

function drawWhiteboard(ctx, x, y, s) {
  // Frame
  ctx.fillStyle = '#888';
  ctx.fillRect(x, y, 18 * s, 12 * s);
  // White surface
  ctx.fillStyle = '#F5F5F5';
  ctx.fillRect(x + s, y + s, 16 * s, 10 * s);
  // Some scribbles
  ctx.fillStyle = '#E74C3C';
  ctx.fillRect(x + 3 * s, y + 3 * s, 5 * s, s);
  ctx.fillStyle = '#3498DB';
  ctx.fillRect(x + 3 * s, y + 5 * s, 8 * s, s);
  ctx.fillStyle = '#2ECC71';
  ctx.fillRect(x + 3 * s, y + 7 * s, 6 * s, s);
  // Marker tray
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 4 * s, y + 11 * s, 10 * s, s);
  // Markers
  ctx.fillStyle = '#E74C3C';
  ctx.fillRect(x + 5 * s, y + 10.5 * s, s, s);
  ctx.fillStyle = '#3498DB';
  ctx.fillRect(x + 7 * s, y + 10.5 * s, s, s);
  ctx.fillStyle = '#2ECC71';
  ctx.fillRect(x + 9 * s, y + 10.5 * s, s, s);
}

function drawCoffeeMachine(ctx, x, y, s) {
  // Body
  ctx.fillStyle = '#333';
  ctx.fillRect(x, y - 7 * s, 6 * s, 7 * s);
  ctx.fillStyle = '#555';
  ctx.fillRect(x + s, y - 6 * s, 4 * s, 4 * s);
  // Cup
  ctx.fillStyle = '#F5F5DC';
  ctx.fillRect(x + 2 * s, y - s, 2 * s, 2 * s);
  // Steam
  ctx.fillStyle = 'rgba(200,200,200,0.6)';
  ctx.fillRect(x + 2 * s, y - 3 * s, s, s);
  ctx.fillRect(x + 3 * s, y - 4 * s, s, s);
  // Light
  ctx.fillStyle = '#00FF00';
  ctx.fillRect(x + s, y - 2 * s, s, s);
}

function drawPrinter(ctx, x, y, s) {
  // Body
  ctx.fillStyle = '#666';
  ctx.fillRect(x, y - 4 * s, 8 * s, 5 * s);
  ctx.fillStyle = '#888';
  ctx.fillRect(x + s, y - 3 * s, 6 * s, 2 * s);
  // Paper tray
  ctx.fillStyle = '#F5F5DC';
  ctx.fillRect(x + 2 * s, y - 5 * s, 4 * s, 2 * s);
  // Output paper
  ctx.fillStyle = '#FFF';
  ctx.fillRect(x + 2 * s, y, 4 * s, s);
  // Buttons
  ctx.fillStyle = '#00FF00';
  ctx.fillRect(x + 6 * s, y - 3 * s, s, s);
  ctx.fillStyle = '#FF0';
  ctx.fillRect(x + 6 * s, y - 2 * s, s, s);
}

function drawClock(ctx, x, y, s) {
  // Face
  ctx.fillStyle = '#FFF';
  ctx.beginPath();
  ctx.arc(x + 3 * s, y + 3 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = s * 0.5;
  ctx.stroke();
  // Hour hand
  ctx.strokeStyle = '#333';
  ctx.lineWidth = s * 0.6;
  ctx.beginPath();
  ctx.moveTo(x + 3 * s, y + 3 * s);
  ctx.lineTo(x + 3 * s, y + 1.5 * s);
  ctx.stroke();
  // Minute hand
  ctx.lineWidth = s * 0.4;
  ctx.beginPath();
  ctx.moveTo(x + 3 * s, y + 3 * s);
  ctx.lineTo(x + 4.5 * s, y + 2 * s);
  ctx.stroke();
  // Center dot
  ctx.fillStyle = '#E74C3C';
  ctx.beginPath();
  ctx.arc(x + 3 * s, y + 3 * s, s * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrashBin(ctx, x, y, s) {
  ctx.fillStyle = '#666';
  ctx.fillRect(x, y, 4 * s, 5 * s);
  ctx.fillStyle = '#777';
  ctx.fillRect(x - s * 0.5, y - s, 5 * s, s);
  // Trash inside
  ctx.fillStyle = '#888';
  ctx.fillRect(x + s, y + s, 2 * s, 2 * s);
}

function drawRug(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  // Border pattern
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
  // Inner border
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + 4, y + 4, w - 8, 1);
  ctx.fillRect(x + 4, y + h - 5, w - 8, 1);
  ctx.fillRect(x + 4, y + 4, 1, h - 8);
  ctx.fillRect(x + w - 5, y + 4, 1, h - 8);
}

function drawWindow(ctx, x, y, s) {
  // Frame
  ctx.fillStyle = '#6B4226';
  ctx.fillRect(x, y, 14 * s, 10 * s);
  // Glass (sky blue)
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(x + s, y + s, 5.5 * s, 3.5 * s);
  ctx.fillRect(x + 7.5 * s, y + s, 5.5 * s, 3.5 * s);
  ctx.fillRect(x + s, y + 5.5 * s, 5.5 * s, 3.5 * s);
  ctx.fillRect(x + 7.5 * s, y + 5.5 * s, 5.5 * s, 3.5 * s);
  // Cross bar
  ctx.fillStyle = '#6B4226';
  ctx.fillRect(x + 6 * s, y, 2 * s, 10 * s);
  ctx.fillRect(x, y + 4.5 * s, 14 * s, s);
  // Sunlight effect
  ctx.fillStyle = 'rgba(255,255,200,0.15)';
  ctx.fillRect(x + 2 * s, y + 2 * s, 3 * s, 2 * s);
  ctx.fillRect(x + 8.5 * s, y + 2 * s, 3 * s, 2 * s);
  // Curtains
  ctx.fillStyle = 'rgba(139,66,38,0.4)';
  ctx.fillRect(x - s, y, 2 * s, 10 * s);
  ctx.fillRect(x + 13 * s, y, 2 * s, 10 * s);
}

function drawHangingLamp(ctx, x, y, s) {
  // Wire
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 2 * s, y, s, 3 * s);
  // Shade
  ctx.fillStyle = '#D4A574';
  ctx.fillRect(x, y + 3 * s, 5 * s, 3 * s);
  // Light glow
  ctx.fillStyle = 'rgba(255,255,200,0.3)';
  ctx.fillRect(x + s, y + 4 * s, 3 * s, 2 * s);
  // Warm glow below
  ctx.fillStyle = 'rgba(255,255,200,0.06)';
  ctx.beginPath();
  ctx.arc(x + 2.5 * s, y + 6 * s, 8 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawPictureFrame(ctx, x, y, s) {
  // Frame
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x, y, 8 * s, 6 * s);
  // Picture (landscape)
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(x + s, y + s, 6 * s, 4 * s);
  // Mountains
  ctx.fillStyle = '#228B22';
  ctx.beginPath();
  ctx.moveTo(x + s, y + 4 * s);
  ctx.lineTo(x + 3 * s, y + 2 * s);
  ctx.lineTo(x + 5 * s, y + 3 * s);
  ctx.lineTo(x + 7 * s, y + 1.5 * s);
  ctx.lineTo(x + 7 * s, y + 4 * s);
  ctx.closePath();
  ctx.fill();
  // Sun
  ctx.fillStyle = '#F39C12';
  ctx.beginPath();
  ctx.arc(x + 6 * s, y + 2 * s, s, 0, Math.PI * 2);
  ctx.fill();
}

function drawFileCabinet(ctx, x, y, s) {
  ctx.fillStyle = '#778899';
  ctx.fillRect(x, y - 10 * s, 6 * s, 12 * s);
  // Drawers
  for (let i = 0; i < 3; i++) {
    const dy = y - 9 * s + i * 4 * s;
    ctx.fillStyle = '#8899AA';
    ctx.fillRect(x + s * 0.5, dy, 5 * s, 3 * s);
    // Handle
    ctx.fillStyle = '#AAA';
    ctx.fillRect(x + 2 * s, dy + s, 2 * s, s);
  }
}

function drawCouch(ctx, x, y, s) {
  // Back
  ctx.fillStyle = '#6B4226';
  ctx.fillRect(x, y - 2 * s, 16 * s, 3 * s);
  // Seat
  ctx.fillStyle = '#8B5A2B';
  ctx.fillRect(x, y + s, 16 * s, 4 * s);
  // Cushions
  ctx.fillStyle = '#A0522D';
  ctx.fillRect(x + s, y + 2 * s, 6 * s, 2 * s);
  ctx.fillRect(x + 9 * s, y + 2 * s, 6 * s, 2 * s);
  // Arms
  ctx.fillStyle = '#6B4226';
  ctx.fillRect(x - s, y, 2 * s, 5 * s);
  ctx.fillRect(x + 15 * s, y, 2 * s, 5 * s);
}

// ===== Boss Office luxury furniture =====
function drawLuxuryCouch(ctx, x, y, s) {
  // Big luxury sofa - dark leather
  const cw = 24 * s, ch = 8 * s;
  // Sofa back (tall, plush)
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x, y - 3 * s, cw, 4 * s);
  ctx.fillStyle = '#4E2B14';
  ctx.fillRect(x + s, y - 2.5 * s, cw - 2 * s, 3 * s);
  // Seat
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(x, y + s, cw, ch);
  // Cushion segments (3 seats)
  ctx.fillStyle = '#6B3D1E';
  ctx.fillRect(x + s, y + 2 * s, 7 * s, 5 * s);
  ctx.fillRect(x + 9 * s, y + 2 * s, 7 * s, 5 * s);
  ctx.fillRect(x + 17 * s, y + 2 * s, 6 * s, 5 * s);
  // Cushion highlights
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + 2 * s, y + 3 * s, 5 * s, 2 * s);
  ctx.fillRect(x + 10 * s, y + 3 * s, 5 * s, 2 * s);
  ctx.fillRect(x + 18 * s, y + 3 * s, 4 * s, 2 * s);
  // Arms (thick, rounded)
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x - 2 * s, y - s, 3 * s, ch + 2 * s);
  ctx.fillRect(x + cw - s, y - s, 3 * s, ch + 2 * s);
  // Arm top highlight
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(x - 2 * s, y - s, 3 * s, 2 * s);
  ctx.fillRect(x + cw - s, y - s, 3 * s, 2 * s);
  // Decorative buttons on back
  ctx.fillStyle = '#8B6914';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x + 4 * s + i * 8 * s, y - s, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLuxuryRug(ctx, x, y, w, h) {
  // Rich patterned rug
  ctx.fillStyle = '#7B2D26';
  ctx.fillRect(x, y, w, h);
  // Border pattern (gold)
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x, y, w, 3);
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.fillRect(x, y, 3, h);
  ctx.fillRect(x + w - 3, y, 3, h);
  // Inner border
  ctx.fillStyle = '#DAA520';
  ctx.fillRect(x + 6, y + 6, w - 12, 2);
  ctx.fillRect(x + 6, y + h - 8, w - 12, 2);
  ctx.fillRect(x + 6, y + 6, 2, h - 12);
  ctx.fillRect(x + w - 8, y + 6, 2, h - 12);
  // Center medallion
  ctx.fillStyle = '#8B4513';
  const cx = x + w / 2, cy = y + h / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 5, h / 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#B8860B';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 7, h / 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawGoldPictureFrame(ctx, x, y, s) {
  // Ornate gold frame
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x, y, 10 * s, 8 * s);
  ctx.fillStyle = '#DAA520';
  ctx.fillRect(x + s * 0.5, y + s * 0.5, 9 * s, 7 * s);
  // Picture inside - abstract art
  ctx.fillStyle = '#1a1a3a';
  ctx.fillRect(x + s, y + s, 8 * s, 6 * s);
  ctx.fillStyle = '#C0392B';
  ctx.fillRect(x + 2 * s, y + 2 * s, 3 * s, 4 * s);
  ctx.fillStyle = '#2980B9';
  ctx.fillRect(x + 5 * s, y + 2 * s, 3 * s, 2 * s);
  ctx.fillStyle = '#F39C12';
  ctx.fillRect(x + 5 * s, y + 4 * s, 3 * s, 2 * s);
}

function drawCoffeeTable(ctx, x, y, s) {
  // Glass coffee table
  ctx.fillStyle = '#666';
  ctx.fillRect(x, y, 10 * s, 6 * s);
  ctx.fillStyle = 'rgba(200,230,255,0.3)';
  ctx.fillRect(x + s * 0.5, y + s * 0.5, 9 * s, 5 * s);
  // Reflection
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(x + s, y + s, 4 * s, 2 * s);
  // Legs
  ctx.fillStyle = '#888';
  ctx.fillRect(x + s, y + 5 * s, s, s);
  ctx.fillRect(x + 8 * s, y + 5 * s, s, s);
}

// ===== Additional Boss Office Luxury Furniture =====
function drawWineCabinet(ctx, x, y, s) {
  // Tall mahogany wine cabinet
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x, y - 14 * s, 8 * s, 16 * s);
  // Inner shelf panels
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(x + s, y - 13 * s, 6 * s, 14 * s);
  // Glass front
  ctx.fillStyle = 'rgba(200,230,255,0.12)';
  ctx.fillRect(x + s, y - 13 * s, 6 * s, 8 * s);
  // Shelves
  ctx.fillStyle = '#4E2B14';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + s, y - 13 * s + i * 3.5 * s, 6 * s, s * 0.5);
  }
  // Wine bottles (colored)
  const bottleColors = ['#4A0E0E', '#2E1A47', '#1A3A1A', '#4A0E0E', '#2E1A47', '#5A2020'];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      ctx.fillStyle = bottleColors[(row * 3 + col) % bottleColors.length];
      ctx.fillRect(x + (1.5 + col * 2) * s, y - 12.5 * s + row * 3.5 * s, s, 2.5 * s);
      // Bottle cap
      ctx.fillStyle = '#B8860B';
      ctx.fillRect(x + (1.5 + col * 2) * s, y - 12.5 * s + row * 3.5 * s, s, s * 0.4);
    }
  }
  // Gold handles
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x + 3 * s, y - 4 * s, s, s);
  ctx.fillRect(x + 5 * s, y - 4 * s, s, s);
  // Crown molding on top
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x - s * 0.5, y - 14.5 * s, 9 * s, s);
}

function drawGlobe(ctx, x, y, s) {
  // Decorative globe on brass stand
  // Stand base
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x - 2 * s, y + 3 * s, 6 * s, s);
  ctx.fillStyle = '#A07828';
  ctx.fillRect(x - s, y + 2 * s, 4 * s, s);
  // Stand pole
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x + s * 0.5, y - s, s, 3 * s);
  // Globe arc frame
  ctx.fillStyle = '#DAA520';
  ctx.beginPath();
  ctx.arc(x + s, y - 3 * s, 3.5 * s, 0, Math.PI * 2);
  ctx.fill();
  // Globe body (blue/green)
  ctx.fillStyle = '#1a5276';
  ctx.beginPath();
  ctx.arc(x + s, y - 3 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  // Continents (simplified green patches)
  ctx.fillStyle = '#1e8449';
  ctx.fillRect(x - s, y - 5 * s, 2 * s, 2 * s);
  ctx.fillRect(x + s, y - 3 * s, 2 * s, s);
  ctx.fillRect(x - 0.5 * s, y - 2 * s, s, s);
  // Equator line
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x - 2.5 * s, y - 3.3 * s, 7 * s, s * 0.3);
  // Shine
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(x - s, y - 5 * s, s, s);
}

function drawFloorLamp(ctx, x, y, s) {
  // Elegant brass floor lamp
  // Base
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x - s, y + s, 4 * s, s);
  ctx.fillStyle = '#A07828';
  ctx.fillRect(x, y - 2 * s, 2 * s, 3 * s);
  // Tall pole
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x + s * 0.5, y - 14 * s, s, 12 * s);
  // Lamp shade (cream colored)
  ctx.fillStyle = '#D4C5A9';
  ctx.fillRect(x - 2 * s, y - 18 * s, 6 * s, 4 * s);
  ctx.fillStyle = '#E8DCC8';
  ctx.fillRect(x - s, y - 17 * s, 4 * s, 2 * s);
  // Gold trim
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x - 2 * s, y - 18 * s, 6 * s, s * 0.5);
  ctx.fillRect(x - 2 * s, y - 14 * s, 6 * s, s * 0.5);
  // Warm glow
  ctx.fillStyle = 'rgba(255,245,210,0.08)';
  ctx.beginPath();
  ctx.arc(x + s, y - 12 * s, 10 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawSideTable(ctx, x, y, s) {
  // Small round side table with items
  // Table surface
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(x, y, 6 * s, 4 * s);
  ctx.fillStyle = '#6B3D1E';
  ctx.fillRect(x + s * 0.5, y + s * 0.5, 5 * s, 3 * s);
  // Legs
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x + s * 0.5, y + 4 * s, s, 2 * s);
  ctx.fillRect(x + 4.5 * s, y + 4 * s, s, 2 * s);
  // Whiskey glass on table
  ctx.fillStyle = 'rgba(200,160,80,0.6)';
  ctx.fillRect(x + s, y - s, 2 * s, s);
  ctx.fillStyle = 'rgba(200,200,200,0.3)';
  ctx.fillRect(x + s, y - 2 * s, 2 * s, 2 * s);
  // Small lamp
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(x + 4 * s, y - s, s, s);
  ctx.fillStyle = '#D4C5A9';
  ctx.fillRect(x + 3.5 * s, y - 3 * s, 2 * s, 2 * s);
  ctx.fillStyle = 'rgba(255,245,210,0.1)';
  ctx.beginPath();
  ctx.arc(x + 4.5 * s, y - 2 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawAwardShelf(ctx, x, y, s) {
  // Wall-mounted award/trophy shelf
  // Shelf bracket
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(x, y, 10 * s, s);
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x + s, y + s, s, 2 * s);
  ctx.fillRect(x + 8 * s, y + s, s, 2 * s);
  // Trophies
  // Gold trophy
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + s, y - 4 * s, 2 * s, 4 * s);
  ctx.fillRect(x + s * 0.5, y - 5 * s, 3 * s, s);
  ctx.fillRect(x + s * 0.5, y - s, 3 * s, s);
  // Silver trophy
  ctx.fillStyle = '#C0C0C0';
  ctx.fillRect(x + 4.5 * s, y - 3 * s, 2 * s, 3 * s);
  ctx.fillRect(x + 4 * s, y - 4 * s, 3 * s, s);
  ctx.fillRect(x + 4 * s, y - s, 3 * s, s);
  // Bronze trophy
  ctx.fillStyle = '#CD7F32';
  ctx.fillRect(x + 8 * s, y - 3 * s, s, 3 * s);
  ctx.fillRect(x + 7.5 * s, y - 4 * s, 2 * s, s);
  ctx.fillRect(x + 7.5 * s, y - s, 2 * s, s);
}

function drawLuxuryChair(ctx, x, y, s) {
  // Executive leather armchair (single, for guest seating)
  // Seat
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x, y, 8 * s, 5 * s);
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(x + s, y + s, 6 * s, 3 * s);
  // Back
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x + s, y - 3 * s, 6 * s, 4 * s);
  ctx.fillStyle = '#4E2B14';
  ctx.fillRect(x + 2 * s, y - 2 * s, 4 * s, 2 * s);
  // Button tufting
  ctx.fillStyle = '#8B6914';
  ctx.beginPath();
  ctx.arc(x + 4 * s, y - s, s * 0.4, 0, Math.PI * 2);
  ctx.fill();
  // Arms
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(x - s, y - s, 2 * s, 6 * s);
  ctx.fillRect(x + 7 * s, y - s, 2 * s, 6 * s);
  // Arm top
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(x - s, y - s, 2 * s, s);
  ctx.fillRect(x + 7 * s, y - s, 2 * s, s);
}

function drawBossRoom(ctx, room, s) {
  // === Premium floor ===
  ctx.fillStyle = '#4A3728';
  ctx.fillRect(room.x, room.y, room.w, room.h);
  // Parquet floor pattern (herringbone style)
  ctx.fillStyle = '#5C4A3A';
  const tileSize = 14;
  for (let tx = room.x; tx < room.x + room.w; tx += tileSize) {
    for (let ty = room.y; ty < room.y + room.h; ty += tileSize) {
      if ((Math.floor((tx - room.x) / tileSize) + Math.floor((ty - room.y) / tileSize)) % 2 === 0) {
        ctx.fillRect(tx, ty, tileSize, tileSize);
      }
    }
  }
  // Additional floor sheen
  ctx.fillStyle = 'rgba(255,220,160,0.02)';
  ctx.fillRect(room.x, room.y, room.w, room.h);

  // ========================================
  // ZONE LAYOUT (top to bottom):
  //   [0-56]   Panoramic window (wall zone)
  //   [56-110] Boss desk area (center) + bookshelf(left) + wine cabinet(right)
  //   [110-210] Secretary desk(right) + globe(left) + award shelf(wall)
  //   [210-310] Lounge: sofa(left) + chairs(right) + coffee table(center)
  //   [310-360] Bottom: plants, floor lamps, rug extends
  // ========================================

  // === Large luxury rug covering central area ===
  drawLuxuryRug(ctx, room.x + 20, room.y + 200, room.w - 40, 130);
  // Smaller accent rug near desk
  ctx.fillStyle = 'rgba(139,69,19,0.15)';
  ctx.fillRect(room.x + room.w / 2 - 60, room.y + 70, 120, 50);
  ctx.fillStyle = 'rgba(184,134,11,0.08)';
  ctx.fillRect(room.x + room.w / 2 - 56, room.y + 74, 112, 42);

  // === Walls (mahogany paneling) ===
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(room.x, room.y - 26, room.w, 26);
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(room.x, room.y - 32, room.w, 6);
  // Gold crown molding
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(room.x, room.y - 33, room.w, 2);
  // Side walls
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(room.x - 6, room.y - 32, 6, room.h + 38);
  ctx.fillRect(room.x + room.w, room.y - 32, 6, room.h + 38);
  ctx.fillRect(room.x - 6, room.y + room.h, room.w + 12, 6);
  // Wainscoting on side walls
  ctx.fillStyle = '#4E2B14';
  ctx.fillRect(room.x - 5, room.y + room.h * 0.5, 4, room.h * 0.5);
  ctx.fillRect(room.x + room.w + 1, room.y + room.h * 0.5, 4, room.h * 0.5);

  // === Door (mahogany with gold handle) ===
  ctx.fillStyle = '#4E2B14';
  ctx.fillRect(room.x + room.w / 2 - 14, room.y + room.h - 3, 28, 9);
  ctx.fillStyle = '#6B3D1E';
  ctx.fillRect(room.x + room.w / 2 - 12, room.y + room.h, 24, 6);
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(room.x + room.w / 2 + 7, room.y + room.h + 1, 4, 4);

  // =========================================================
  // === PANORAMIC FLOOR-TO-CEILING WINDOW — Modern Skyline ===
  // =========================================================
  const winMargin = 12;
  const winX = room.x + winMargin;
  const winY = room.y - 24;
  const winW = room.w - winMargin * 2;
  const winH = 56;

  // Window frame (sleek steel frame)
  ctx.fillStyle = '#A0A0A0';
  ctx.fillRect(winX, winY, winW, winH);
  ctx.fillStyle = '#C8C8C8';
  ctx.fillRect(winX + 1, winY + 1, winW - 2, winH - 2);

  // Sky gradient (dusk / golden hour)
  const skyGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
  skyGrad.addColorStop(0, '#1a1a3e');
  skyGrad.addColorStop(0.25, '#2d2b55');
  skyGrad.addColorStop(0.45, '#4a3f6b');
  skyGrad.addColorStop(0.65, '#c97b4b');
  skyGrad.addColorStop(0.85, '#e8a050');
  skyGrad.addColorStop(1, '#f0c878');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(winX + 2, winY + 2, winW - 4, winH - 4);

  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  const starSeed = hashStr(room.id + 'stars');
  for (let i = 0; i < 12; i++) {
    const sx = winX + 4 + ((starSeed * (i + 1) * 7) % (winW - 8));
    const sy = winY + 3 + ((starSeed * (i + 3) * 13) % 14);
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Moon (crescent)
  ctx.fillStyle = 'rgba(255,255,230,0.9)';
  ctx.beginPath();
  ctx.arc(winX + winW - 30, winY + 12, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d2b55';
  ctx.beginPath();
  ctx.arc(winX + winW - 27, winY + 11, 5, 0, Math.PI * 2);
  ctx.fill();

  // === CITY SKYLINE ===
  const skylineY = winY + winH - 2;
  const buildingBaseY = skylineY;

  ctx.fillStyle = 'rgba(40,35,60,0.8)';
  const bgBuildings = [
    { x: 0.05, w: 0.04, h: 0.45 }, { x: 0.1, w: 0.03, h: 0.55 },
    { x: 0.15, w: 0.05, h: 0.35 }, { x: 0.22, w: 0.03, h: 0.60 },
    { x: 0.28, w: 0.04, h: 0.40 }, { x: 0.35, w: 0.03, h: 0.50 },
    { x: 0.42, w: 0.06, h: 0.30 }, { x: 0.52, w: 0.03, h: 0.55 },
    { x: 0.58, w: 0.04, h: 0.38 }, { x: 0.65, w: 0.03, h: 0.62 },
    { x: 0.72, w: 0.05, h: 0.42 }, { x: 0.78, w: 0.03, h: 0.50 },
    { x: 0.85, w: 0.04, h: 0.35 }, { x: 0.92, w: 0.03, h: 0.48 },
  ];
  bgBuildings.forEach(b => {
    const bx = winX + 2 + b.x * (winW - 4);
    const bw = b.w * (winW - 4);
    const bh = b.h * (winH * 0.6);
    ctx.fillRect(bx, buildingBaseY - bh, bw, bh);
  });

  const fgBuildings = [
    { x: 0.02, w: 0.07, h: 0.75, color: '#2a2a4a' },
    { x: 0.10, w: 0.05, h: 0.85, color: '#333355' },
    { x: 0.17, w: 0.08, h: 0.60, color: '#2d2d50' },
    { x: 0.27, w: 0.05, h: 0.90, color: '#353560' },
    { x: 0.34, w: 0.06, h: 0.70, color: '#303050' },
    { x: 0.42, w: 0.09, h: 0.55, color: '#282848' },
    { x: 0.53, w: 0.05, h: 0.95, color: '#333360' },
    { x: 0.60, w: 0.07, h: 0.65, color: '#2a2a50' },
    { x: 0.69, w: 0.05, h: 0.80, color: '#353558' },
    { x: 0.76, w: 0.08, h: 0.58, color: '#2d2d4a' },
    { x: 0.86, w: 0.05, h: 0.72, color: '#303055' },
    { x: 0.93, w: 0.06, h: 0.50, color: '#282845' },
  ];
  fgBuildings.forEach((b, bi) => {
    const bx = winX + 2 + b.x * (winW - 4);
    const bw = b.w * (winW - 4);
    const bh = b.h * (winH * 0.65);
    const by = buildingBaseY - bh;
    ctx.fillStyle = b.color;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, by, bw, 2);
    if (b.h > 0.8 && bw > 6) {
      ctx.fillStyle = 'rgba(200,200,200,0.5)';
      ctx.fillRect(bx + bw / 2, by - 5, 1, 5);
      ctx.fillStyle = '#ff3333';
      ctx.fillRect(bx + bw / 2, by - 6, 1, 1);
    }
    const winSpacingX = Math.max(3, Math.floor(bw / 4));
    const winSpacingY = 4;
    const wSeed = hashStr(room.id + 'bld' + bi);
    for (let wy = by + 4; wy < buildingBaseY - 3; wy += winSpacingY) {
      for (let wx = bx + 2; wx < bx + bw - 2; wx += winSpacingX) {
        const lit = ((wSeed + wx * 7 + wy * 13) % 5) < 3;
        if (lit) {
          ctx.fillStyle = ((wSeed + wx + wy) % 3 === 0)
            ? 'rgba(255,240,180,0.7)' : 'rgba(200,220,255,0.5)';
          ctx.fillRect(wx, wy, 2, 2);
        }
      }
    }
  });

  ctx.fillStyle = 'rgba(232,160,80,0.15)';
  ctx.fillRect(winX + 2, buildingBaseY - 6, winW - 4, 6);

  // Window dividers
  ctx.fillStyle = '#B0B0B0';
  const divCount = Math.max(2, Math.floor(winW / 80));
  for (let d = 1; d < divCount; d++) {
    ctx.fillRect(winX + d * (winW / divCount), winY, 1, winH);
  }
  ctx.fillRect(winX, winY + winH * 0.45, winW, 1);

  // Warm light cast into room
  ctx.fillStyle = 'rgba(255,240,200,0.04)';
  ctx.beginPath();
  ctx.moveTo(winX, winY + winH);
  ctx.lineTo(winX - 10, room.y + room.h);
  ctx.lineTo(winX + winW + 10, room.y + room.h);
  ctx.lineTo(winX + winW, winY + winH);
  ctx.closePath();
  ctx.fill();

  // === Crystal chandelier (centered) ===
  const chandelierX = room.x + room.w / 2;
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(chandelierX - s, room.y + 38, 2 * s, 2 * s);
  ctx.fillStyle = '#DAA520';
  ctx.fillRect(chandelierX - 5 * s, room.y + 40, 10 * s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = -4; i <= 4; i++) {
    ctx.fillRect(chandelierX + i * s, room.y + 41, s * 0.5, 2 * s);
  }
  ctx.fillStyle = 'rgba(255,255,200,0.06)';
  ctx.beginPath();
  ctx.arc(chandelierX, room.y + 44, 35 * s * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // =====================================================
  // ZONE 1: BOSS DESK AREA (y+65 to y+140)
  // Left: File cabinet + Award shelf on wall
  // Center: Executive desk with dual monitors
  // Right: Bookshelf
  // =====================================================

  // Award shelf on left wall
  drawAwardShelf(ctx, room.x + 12, room.y + 60, s * 0.7);

  // File cabinet (left side)
  drawFileCabinet(ctx, room.x + 10, room.y + 115, s * 0.85);

  // === Boss desk (large executive desk, centered) ===
  const deskX = room.x + room.w / 2 - 20 * s * 0.5;
  const deskY = room.y + 105;
  ctx.fillStyle = '#3D1F0F';
  ctx.fillRect(deskX, deskY, 20 * s, 8 * s);
  ctx.fillStyle = '#5C3317';
  ctx.fillRect(deskX + s, deskY + s, 18 * s, 6 * s);
  ctx.fillStyle = '#6B3D1E';
  ctx.fillRect(deskX + 2 * s, deskY + 2 * s, 16 * s, 4 * s);
  ctx.fillStyle = '#B8860B';
  ctx.fillRect(deskX, deskY, 20 * s, s * 0.5);
  // Desk drawer handles
  ctx.fillStyle = '#DAA520';
  ctx.fillRect(deskX + 3 * s, deskY + 5 * s, 2 * s, s * 0.5);
  ctx.fillRect(deskX + 15 * s, deskY + 5 * s, 2 * s, s * 0.5);

  // Dual monitors on desk
  ctx.fillStyle = '#222';
  ctx.fillRect(deskX + 4 * s, deskY - 5 * s, 5 * s, 5 * s);
  ctx.fillStyle = '#3a7a9a';
  ctx.fillRect(deskX + 5 * s, deskY - 4 * s, 3 * s, 3 * s);
  ctx.fillStyle = '#555';
  ctx.fillRect(deskX + 5.5 * s, deskY, 2 * s, s);
  ctx.fillStyle = '#222';
  ctx.fillRect(deskX + 11 * s, deskY - 5 * s, 5 * s, 5 * s);
  ctx.fillStyle = '#3a7a9a';
  ctx.fillRect(deskX + 12 * s, deskY - 4 * s, 3 * s, 3 * s);
  ctx.fillStyle = '#555';
  ctx.fillRect(deskX + 12.5 * s, deskY, 2 * s, s);
  // Pen holder on desk
  ctx.fillStyle = '#333';
  ctx.fillRect(deskX + 18 * s, deskY + s, 2 * s, 3 * s);
  ctx.fillStyle = '#E74C3C';
  ctx.fillRect(deskX + 18 * s, deskY - s, s * 0.5, 2 * s);
  ctx.fillStyle = '#3498DB';
  ctx.fillRect(deskX + 19 * s, deskY - s, s * 0.5, 2 * s);

  // Bookshelf (right side, near wall)
  drawBookshelf(ctx, room.x + room.w - 42, room.y + 75, s * 0.9);

  // =====================================================
  // ZONE 2: SECRETARY AREA (y+140 to y+210)
  // Right side: Secretary desk
  // Left side: Globe on stand
  // =====================================================

  // Secretary desk (right side)
  if (room.members.length > 1) {
    const secDeskX = room.x + room.w - 85;
    const secDeskY = room.y + 140;
    drawDesk(ctx, secDeskX, secDeskY, s);
  }

  // Globe (left side, mid area)
  drawGlobe(ctx, room.x + 30, room.y + 185, s * 1.1);

  // Gold picture frame on left wall (between zones)
  drawGoldPictureFrame(ctx, room.x + 12, room.y + 148, s * 0.65);

  // =====================================================
  // ZONE 3: LOUNGE AREA (y+210 to y+310)
  // Left: Luxury sofa
  // Center: Coffee table
  // Right: Two guest armchairs
  // =====================================================

  // Luxury sofa (left side of lounge)
  drawLuxuryCouch(ctx, room.x + 16, room.y + room.h - 100, s * 0.8);

  // Coffee table (center of lounge)
  drawCoffeeTable(ctx, room.x + room.w / 2 - 15, room.y + room.h - 80, s * 0.9);

  // Two guest armchairs (right side, facing the sofa)
  drawLuxuryChair(ctx, room.x + room.w - 55, room.y + room.h - 105, s * 0.75);
  drawLuxuryChair(ctx, room.x + room.w - 55, room.y + room.h - 75, s * 0.75);

  // Side table between the chairs
  drawSideTable(ctx, room.x + room.w - 42, room.y + room.h - 90, s * 0.65);

  // Wine cabinet (right wall, between zone 2 and 3)
  drawWineCabinet(ctx, room.x + room.w - 36, room.y + 210, s * 0.85);

  // =====================================================
  // ZONE 4: FLOOR PERIMETER (decorations)
  // =====================================================

  // Floor lamps (left and right corners)
  drawFloorLamp(ctx, room.x + 12, room.y + room.h - 30, s * 0.7);
  drawFloorLamp(ctx, room.x + room.w - 18, room.y + room.h - 30, s * 0.7);

  // Large plants at bottom corners
  drawPlant(ctx, room.x + room.w - 26, room.y + room.h - 28, s);
  drawPlant(ctx, room.x + 40, room.y + room.h - 28, s);
  // Small plant near desk
  drawSmallPlant(ctx, room.x + room.w / 2 + 45, room.y + 135, s * 0.8);
  // Small plant near sofa
  drawSmallPlant(ctx, room.x + 60, room.y + room.h - 40, s * 0.7);

  // === Room name sign (gold) ===
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  roundRect(ctx, room.x + 10, room.y - 29, Math.min(room.w - 20, 220), 20, 4);
  ctx.fill();
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(room.name, room.x + 18, room.y - 19);
}

// ===== Desk pair for 2x2 employees (side-view style, like secretary desk) =====
// Layout (s=3, all relative to pairX, pairY which is the top-left of the desk group):
//
// WORKSTATION_W = 14s per person, total pair width = 30s (2 workstations + 2s gap)
//
//   [top-left person]       [top-right person]       <- y offset: -14s (characters, ~12s tall)
//   [chair top]             [chair top]              <- y offset: -2s to 0
//   [monitor + desk top]    [monitor + desk top]     <- y offset: 0 to 6s (desk=6s, monitor on desk -5s to 0)
//   ========= divider =========                      <- y offset: 6s to 7s
//   [monitor + desk bottom] [monitor + desk bottom]  <- y offset: 7s to 13s
//   [chair bottom]          [chair bottom]           <- y offset: 13s to 15s
//   [bottom-left person]    [bottom-right person]    <- y offset: 15s (characters sit here)
//
// Total height: from top-person (-14s) to bottom-person-feet (+20s) = 34s
// Obstacle area: desks from y to y+13s

const DESK_PAIR_W_UNITS = 30; // total width in s units
const DESK_PAIR_TOTAL_H_UNITS = 44; // full height including person space top(-14s) to bottom(+30s)
const WORKSTATION_W = 14; // width of one workstation in s units
const WORKSTATION_GAP = 2; // gap between left and right workstation

function drawDeskPair(ctx, x, y, s) {
  // y = top of the upper desk surface
  // Each side has 2 workstations side by side

  const ws = WORKSTATION_W * s; // workstation pixel width
  const gap = WORKSTATION_GAP * s;

  // Workstation X positions (left edge of each workstation)
  const wx0 = x; // left workstation
  const wx1 = x + ws + gap; // right workstation

  // --- Draw each workstation (same style as secretary drawDesk) ---
  // TOP ROW (facing down, monitors face top-row people above)
  drawWorkstation(ctx, wx0, y, s, 'top');
  drawWorkstation(ctx, wx1, y, s, 'top');

  // === DIVIDER between top and bottom rows ===
  ctx.fillStyle = '#666';
  ctx.fillRect(x, y + 6 * s, (DESK_PAIR_W_UNITS) * s, s);
  // Divider highlight
  ctx.fillStyle = '#888';
  ctx.fillRect(x, y + 6 * s, (DESK_PAIR_W_UNITS) * s, s * 0.3);

  // BOTTOM ROW (facing up, monitors face bottom-row people below)
  drawWorkstation(ctx, wx0, y + 7 * s, s, 'bottom');
  drawWorkstation(ctx, wx1, y + 7 * s, s, 'bottom');
}

// Draw a single workstation: desk surface + monitor + keyboard + chair
// direction: 'top' = person sits above, 'bottom' = person sits below
function drawWorkstation(ctx, x, y, s, direction) {
  // Desk surface: 12s wide, 6s tall (same as secretary)
  const deskW = 12 * s;
  const deskH = 6 * s;
  const deskX = x + s; // 1s margin from workstation edge

  ctx.fillStyle = '#8B6914';
  ctx.fillRect(deskX, y, deskW, deskH);
  ctx.fillStyle = '#A07828';
  ctx.fillRect(deskX + s, y + s, (12 - 2) * s, (6 - 2) * s);

  if (direction === 'top') {
    // Person sits ABOVE the desk, looking down at monitor
    // Monitor sits ON TOP of desk, visible above desk surface (like secretary)
    // Monitor body
    ctx.fillStyle = '#333';
    ctx.fillRect(deskX + 3 * s, y - 5 * s, 6 * s, 5 * s);
    // Screen
    ctx.fillStyle = '#4488AA';
    ctx.fillRect(deskX + 4 * s, y - 4 * s, 4 * s, 3 * s);
    // Monitor stand
    ctx.fillStyle = '#555';
    ctx.fillRect(deskX + 5 * s, y, 2 * s, s);
    // Screen glare
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(deskX + 4 * s, y - 4 * s, 2 * s, s);

    // Keyboard (above desk, between person and monitor)
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(deskX + 2 * s, y - 7 * s, 5 * s, s);
    // Key dots
    ctx.fillStyle = '#555';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(deskX + (2.5 + i) * s, y - 6.7 * s, s * 0.5, s * 0.4);
    }
    // Mouse
    ctx.fillStyle = '#555';
    ctx.fillRect(deskX + 8 * s, y - 7 * s, 2 * s, s);

    // Chair
    ctx.fillStyle = 'rgba(80,80,80,0.5)';
    ctx.fillRect(deskX + 2 * s, y - 9 * s, 8 * s, 2 * s);
    // Chair back
    ctx.fillStyle = 'rgba(60,60,60,0.4)';
    ctx.fillRect(deskX + 3 * s, y - 11 * s, 6 * s, 2 * s);

  } else {
    // Person sits BELOW the desk, looking up at monitor
    // Monitor sits below desk surface, facing the bottom person
    // Monitor body
    ctx.fillStyle = '#333';
    ctx.fillRect(deskX + 3 * s, y + deskH, 6 * s, 5 * s);
    // Screen (facing the bottom person)
    ctx.fillStyle = '#4488AA';
    ctx.fillRect(deskX + 4 * s, y + deskH + s, 4 * s, 3 * s);
    // Monitor stand
    ctx.fillStyle = '#555';
    ctx.fillRect(deskX + 5 * s, y + deskH - s, 2 * s, s);
    // Screen glare
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(deskX + 4 * s, y + deskH + s, 2 * s, s);

    // Keyboard (further below monitor, more space for person)
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(deskX + 2 * s, y + deskH + 8 * s, 5 * s, s);
    // Key dots
    ctx.fillStyle = '#555';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(deskX + (2.5 + i) * s, y + deskH + 8.3 * s, s * 0.5, s * 0.4);
    }
    // Mouse
    ctx.fillStyle = '#555';
    ctx.fillRect(deskX + 8 * s, y + deskH + 8 * s, 2 * s, s);

    // Chair (further down)
    ctx.fillStyle = 'rgba(80,80,80,0.5)';
    ctx.fillRect(deskX + 2 * s, y + deskH + 10 * s, 8 * s, 2 * s);
    // Chair back
    ctx.fillStyle = 'rgba(60,60,60,0.4)';
    ctx.fillRect(deskX + 3 * s, y + deskH + 12 * s, 6 * s, 2 * s);
  }
}

// ===== Room Layout Calculator =====
// Helper: compute room dimensions for a department based on member count and available width
function computeRoomSize(memberCount, availW) {
  const s = 3;
  const deskW = DESK_PAIR_W_UNITS * s; // 90px
  const SMALL_THRESHOLD = 4;  // <=4 people → small room (1 desk pair)
  const MED_THRESHOLD = 8;    // <=8 people → medium room

  // Determine room width class based on member count
  let roomW;
  if (memberCount <= SMALL_THRESHOLD) {
    // Small office: compact width — fits 1 desk pair comfortably
    roomW = Math.min(availW, Math.max(220, deskW + 100));
  } else if (memberCount <= MED_THRESHOLD) {
    // Medium office: standard width
    roomW = Math.min(availW, Math.max(320, deskW + 180));
  } else {
    // Large office: full width
    roomW = availW;
  }

  // Compute height based on desk pair rows
  const pairsPerRow = Math.max(1, Math.min(2, Math.floor((roomW - 60) / (deskW + 30))));
  const totalPairs = Math.ceil(memberCount / 4);
  const deskRows = Math.max(1, Math.ceil(totalPairs / pairsPerRow));

  // Small rooms get a more compact base height
  let baseH;
  if (memberCount <= SMALL_THRESHOLD) {
    baseH = 240;
  } else {
    baseH = 300;
  }
  const extraH = Math.max(0, deskRows - 1) * (DESK_PAIR_TOTAL_H_UNITS * s + 40);
  const roomH = baseH + extraH;

  return { roomW, roomH, sizeClass: memberCount <= SMALL_THRESHOLD ? 'small' : memberCount <= MED_THRESHOLD ? 'medium' : 'large' };
}

function calculateRoomLayout(departments, canvasWidth, secretary, boss) {
  const rooms = [];
  const PADDING = 20;
  const fullColW = Math.max(380, canvasWidth - PADDING * 2);

  let startY = PADDING + 36; // extra top space so room title signs are not clipped

  // Boss office (secretary sits inside with the boss)
  if (boss) {
    const maxBossW = Math.min(fullColW, 480);
    const bossW = Math.max(380, maxBossW);
    const rowH = 360; // spacious luxury office with full furniture

    const bossMembers = [{ id: '__boss__', name: boss.name || 'Boss', role: 'CEO' }];
    bossMembers.push({ id: '__secretary__', name: secretary?.name || 'Secretary', role: 'Secretary' });

    rooms.push({
      id: '__boss__',
      name: `👔 ${boss.name || 'Boss'}'s Office`,
      x: PADDING,
      y: startY,
      w: bossW,
      h: rowH,
      palette: { floor: '#4A3728', wall: '#3D1F0F', wallTop: '#5C3317', accent: '#B8860B' },
      members: bossMembers,
      isBoss: true,
    });

    startY += rowH + PADDING;
  } else {
    rooms.push({
      id: '__secretary__',
      name: '🏛️ Secretary Office',
      x: PADDING,
      y: startY,
      w: Math.min(fullColW, canvasWidth - PADDING * 2),
      h: 200,
      palette: { floor: '#9B8B7B', wall: '#705A48', wallTop: '#A0886A', accent: '#D4B896' },
      members: [{ id: '__secretary__', name: secretary?.name || 'Secretary', role: 'Secretary' }],
    });

    startY += 200 + PADDING;
  }

  // Pre-compute size info for all departments
  const deptSizes = departments.map(dept => {
    const memberCount = (dept.members || []).length;
    return { ...computeRoomSize(memberCount, fullColW), memberCount };
  });

  // === Bin-packing: greedily fill rows with rooms (left to right) ===
  // Each row has a max width of canvasWidth - 2*PADDING
  const rowMaxW = canvasWidth - PADDING * 2;
  const rowAssignments = []; // [{deptIdx, x, rowIdx}]
  let currentRow = 0;
  let currentRowX = 0;
  let currentRowRoomCount = 0;
  const rowHeights = {};

  // Sort departments: large first for better packing, but keep original palette assignment
  const sortedIndices = departments.map((_, i) => i);
  // Pack: put large rooms first in each row, then fill with small ones
  // Actually, keep original order for visual consistency (departments appear in order)

  sortedIndices.forEach((origIdx) => {
    const sz = deptSizes[origIdx];
    const neededW = sz.roomW;

    // Check if this room fits in the current row
    const spaceLeft = rowMaxW - currentRowX;
    if (currentRowRoomCount > 0 && neededW + PADDING > spaceLeft) {
      // Move to next row
      currentRow++;
      currentRowX = 0;
      currentRowRoomCount = 0;
    }

    // Also limit to max 3 rooms per row for readability
    if (currentRowRoomCount >= 3) {
      currentRow++;
      currentRowX = 0;
      currentRowRoomCount = 0;
    }

    rowAssignments.push({
      origIdx,
      rowIdx: currentRow,
      x: PADDING + currentRowX,
    });

    rowHeights[currentRow] = Math.max(rowHeights[currentRow] || 0, sz.roomH);
    currentRowX += neededW + PADDING;
    currentRowRoomCount++;
  });

  // Now compute actual widths: if rooms in a row don't fill the full width,
  // proportionally expand them to fill available space (looks better)
  const rowRoomGroups = {};
  rowAssignments.forEach(ra => {
    if (!rowRoomGroups[ra.rowIdx]) rowRoomGroups[ra.rowIdx] = [];
    rowRoomGroups[ra.rowIdx].push(ra);
  });

  Object.keys(rowRoomGroups).forEach(rowIdx => {
    const group = rowRoomGroups[rowIdx];
    const totalDesiredW = group.reduce((sum, ra) => sum + deptSizes[ra.origIdx].roomW, 0);
    const totalGaps = (group.length - 1) * PADDING;
    const availableW = rowMaxW - totalGaps;

    // Proportionally distribute available width
    let xCursor = PADDING;
    group.forEach((ra) => {
      const desiredW = deptSizes[ra.origIdx].roomW;
      const expandedW = Math.floor((desiredW / totalDesiredW) * availableW);
      ra.x = xCursor;
      ra.expandedW = expandedW;
      xCursor += expandedW + PADDING;

      // Recompute height with expanded width (more width may reduce desk rows)
      const memberCount = deptSizes[ra.origIdx].memberCount;
      const recomputed = computeRoomSize(memberCount, expandedW);
      ra.finalH = recomputed.roomH;
      rowHeights[rowIdx] = Math.max(rowHeights[rowIdx] || 0, ra.finalH);
    });
  });

  // Create room objects
  departments.forEach((dept, i) => {
    const ra = rowAssignments.find(r => r.origIdx === i);
    const sz = deptSizes[i];

    // Compute Y from accumulated row heights
    let yOffset = startY;
    for (let r = 0; r < ra.rowIdx; r++) {
      yOffset += (rowHeights[r] || 240) + PADDING + 16;
    }

    const finalW = ra.expandedW || sz.roomW;
    const finalH = rowHeights[ra.rowIdx] || sz.roomH;

    rooms.push({
      id: dept.id,
      name: dept.name,
      x: ra.x,
      y: yOffset,
      w: finalW,
      h: finalH,
      palette: ROOM_PALETTES[i % ROOM_PALETTES.length],
      sizeClass: sz.sizeClass,
      members: (dept.members || []).map(m => ({
        id: m.id,
        name: m.name,
        role: m.role,
        avatar: m.avatar,
      })),
    });
  });

  const lastRoom = rooms[rooms.length - 1];
  const totalH = lastRoom ? lastRoom.y + lastRoom.h + PADDING * 2 : 400;

  return { rooms, totalH };
}

// Calculate fixed desk seat positions for each member in a room.
// Also returns desk obstacle rectangles for collision detection.
//
// New side-view desk pair layout (s=3, relative to pairX, pairY):
//   pairY = top of upper desk surface
//
//   Top person:     y - 16s  (high enough to not overlap with monitor/keyboard)
//   Chair+keyboard: y - 11s to y - 7s
//   Monitor (top):  y - 5s to y      (on desk, facing top person)
//   Top desk:       y to y+6s        <- OBSTACLE
//   Divider:        y+6s to y+7s     <- OBSTACLE
//   Bottom desk:    y+7s to y+13s    <- OBSTACLE
//   Monitor (bot):  y+13s to y+18s   (on desk, facing bottom person)
//   Chair+keyboard: y+19s to y+23s
//   Bottom person:  y + 28s
//
//   Width: 30s (2 workstations of 14s + 2s gap)
//
// Seats:
//   Top-left:  (pairX + 7s, pairY - 14s)
//   Top-right: (pairX + 23s, pairY - 14s)
//   Bot-left:  (pairX + 7s, pairY + 30s)
//   Bot-right: (pairX + 23s, pairY + 30s)

function getSeatPositions(room) {
  const seats = [];
  const obstacles = []; // desk rectangles for collision
  const memberCount = room.members.length;
  if (memberCount === 0) return { seats, obstacles };

  const s = 3; // must match pixel scale

  if (room.id === '__boss__') {
    // Boss sits behind the executive desk (center, upper-mid area)
    seats.push({
      x: room.x + room.w / 2,
      y: room.y + 150,
      deskX: room.x + room.w / 2 - 30,
      deskY: room.y + 105,
    });
    obstacles.push({
      x: room.x + room.w / 2 - 30,
      y: room.y + 105,
      w: 20 * s,
      h: 8 * s,
    });
    // Secretary sits at a smaller desk on the right side, mid-height
    if (room.members.length > 1) {
      seats.push({
        x: room.x + room.w - 65,
        y: room.y + 175,
        deskX: room.x + room.w - 85,
        deskY: room.y + 140,
      });
      obstacles.push({
        x: room.x + room.w - 85,
        y: room.y + 140,
        w: 12 * s,
        h: 6 * s,
      });
    }
    return { seats, obstacles };
  }

  if (room.id === '__secretary__') {
    seats.push({
      x: room.x + room.w / 2,
      y: room.y + 90,
      deskX: room.x + room.w / 2 - 18,
      deskY: room.y + 60,
    });
    // Secretary desk obstacle
    obstacles.push({
      x: room.x + room.w / 2 - 18,
      y: room.y + 60,
      w: 12 * s,
      h: 6 * s,
    });
    return { seats, obstacles };
  }

  const DESK_W = DESK_PAIR_W_UNITS * s; // 90px
  const DESK_GAP_X = 30;
  const DESK_GAP_Y = 40; // vertical gap between desk pair rows

  const pairsPerRow = Math.max(1, Math.min(2, Math.floor((room.w - 60) / (DESK_W + DESK_GAP_X))));

  // Center desk pairs horizontally in the room
  const totalDeskRowW = pairsPerRow * DESK_W + (pairsPerRow - 1) * DESK_GAP_X;
  const DESK_AREA_START_X = room.x + Math.max(15, Math.floor((room.w - totalDeskRowW) / 2));
  const DESK_AREA_START_Y = room.y + (room.w < 300 ? 60 : 80); // small rooms: tighter top margin

  // Seat X offsets: center of each workstation
  // Left workstation desk starts at pairX + 1s, width 12s → center at pairX + 7s
  // Right workstation desk starts at pairX + (14+2+1)s = pairX + 17s, width 12s → center at pairX + 23s
  const seatOffX0 = 7 * s;  // left seat center
  const seatOffX1 = 23 * s; // right seat center

  let seatIndex = 0;
  for (let mi = 0; mi < memberCount; mi++) {
    const pairIndex = Math.floor(seatIndex / 4);
    const seatInPair = seatIndex % 4;

    const pairCol = pairIndex % pairsPerRow;
    const pairRow = Math.floor(pairIndex / pairsPerRow);

    const pairX = DESK_AREA_START_X + pairCol * (DESK_W + DESK_GAP_X);
    const pairY = DESK_AREA_START_Y + pairRow * (DESK_PAIR_TOTAL_H_UNITS * s + DESK_GAP_Y);

    // Register obstacle for this desk pair
    // Covers: monitors(top) + desks + divider + monitors(bottom) + keyboard area
    const obstKey = `${pairCol}-${pairRow}`;
    if (!obstacles.find(o => o._key === obstKey)) {
      obstacles.push({
        _key: obstKey,
        x: pairX - s,
        y: pairY - 6 * s,
        w: DESK_W + 2 * s,
        h: 30 * s, // from top-monitor to bottom-keyboard area
      });
    }

    const seatCol = seatInPair % 2; // 0=left, 1=right
    const seatRow = Math.floor(seatInPair / 2); // 0=top, 1=bottom

    const seatX = pairX + (seatCol === 0 ? seatOffX0 : seatOffX1);
    // Top seats: above desk, high enough to be fully visible
    // Bottom seats: below desk, with enough space
    const seatY = seatRow === 0
      ? pairY - 14 * s
      : pairY + 30 * s;

    seats.push({
      x: seatX,
      y: seatY,
      deskX: pairX,
      deskY: pairY,
      facing: seatRow === 0 ? 'down' : 'up',
    });

    seatIndex++;
  }

  return { seats, obstacles };
}

// Check if a point is inside any obstacle rectangle (with padding)
function isInsideAnyObstacle(px, py, obstacles, pad = 0) {
  for (const o of obstacles) {
    if (px >= o.x - pad && px <= o.x + o.w + pad &&
        py >= o.y - pad && py <= o.y + o.h + pad) {
      return true;
    }
  }
  return false;
}

// ===== Agent Walking State Manager =====
function useAgentPositions(rooms, frame) {
  const stateRef = useRef({});

  // Clamp position within room boundaries (with margin)
  const clampToRoom = (x, y, room) => {
    const margin = 15;
    return {
      x: Math.max(room.x + margin, Math.min(room.x + room.w - margin, x)),
      y: Math.max(room.y + margin, Math.min(room.y + room.h - margin, y)),
    };
  };

  const positions = useMemo(() => {
    const state = stateRef.current;

    // Build a room lookup so we can detect if agent is in wrong room
    const roomById = {};
    rooms.forEach(room => { roomById[room.id] = room; });

    rooms.forEach(room => {
      const { seats, obstacles } = getSeatPositions(room);

      room.members.forEach((member, mi) => {
        const key = member.id;
        const seat = seats[mi];
        if (!seat) return;

        if (!state[key]) {
          // Initialize: start exactly at desk seat, sitting
          state[key] = {
            x: seat.x,
            y: seat.y,
            direction: 0,
            sitting: true,
            target: null,
            seatX: seat.x,
            seatY: seat.y,
            idleTimer: Math.floor(Math.random() * 2000) + 1500, // ~50-120 seconds before first stand
            wanderTimer: 0,
            roomId: room.id,
          };
        }

        const s = state[key];

        // If seat position changed (room recalculated), snap to new seat
        if (s.seatX !== seat.x || s.seatY !== seat.y) {
          const wasSitting = s.sitting;
          s.seatX = seat.x;
          s.seatY = seat.y;
          if (wasSitting) {
            // Snap to new seat position
            s.x = seat.x;
            s.y = seat.y;
          }
        }

        // If room changed, reset to seat
        if (s.roomId !== room.id) {
          s.roomId = room.id;
          s.x = seat.x;
          s.y = seat.y;
          s.sitting = true;
          s.target = null;
          s.direction = 0;
          s.idleTimer = Math.floor(Math.random() * 1500) + 1000;
        }

        // Ensure current position is within room bounds
        if (!s.sitting) {
          const clamped = clampToRoom(s.x, s.y, room);
          s.x = clamped.x;
          s.y = clamped.y;
        }

        if (s.sitting) {
          // Sitting at desk — rarely stand up
          s.direction = 0;
          s.x = s.seatX;
          s.y = s.seatY;
          s.idleTimer--;
          if (s.idleTimer <= 0) {
            // Stand up and wander briefly
            s.sitting = false;
            s.wanderTimer = Math.floor(Math.random() * 80) + 40; // short walk (1-3 seconds)
            // Pick ONE safe destination inside room (avoiding desks)
            const safeMargin = 30;
            const wanderTargets = [
              { x: room.x + room.w - 50, y: room.y + 40 }, // water cooler area
              { x: room.x + room.w - 50, y: room.y + room.h - 40 }, // plant area
              { x: room.x + safeMargin, y: room.y + room.h - 40 }, // bottom-left corner
              { x: room.x + room.w / 2, y: room.y + room.h - 30 }, // door area
            ];
            // Filter out targets that collide with desks
            const safeTgts = wanderTargets.filter(t => !isInsideAnyObstacle(t.x, t.y, obstacles, 10));
            s.target = safeTgts.length > 0
              ? safeTgts[Math.floor(Math.random() * safeTgts.length)]
              : wanderTargets[wanderTargets.length - 1]; // door area as fallback
            // Clamp target to room
            const ct = clampToRoom(s.target.x, s.target.y, room);
            s.target = ct;
          }
        } else {
          // Walking around
          s.wanderTimer--;
          if (s.wanderTimer <= 0 || !s.target) {
            // Time's up — head back to seat
            s.target = { x: s.seatX, y: s.seatY };
            if (Math.abs(s.x - s.seatX) < 3 && Math.abs(s.y - s.seatY) < 3) {
              s.x = s.seatX;
              s.y = s.seatY;
              s.sitting = true;
              s.target = null;
              s.direction = 0;
              // Sit for a long time: 40-120 seconds (at ~30fps with frame/2 tick)
              s.idleTimer = Math.floor(Math.random() * 2400) + 1200;
            }
          }

          if (s.target) {
            const dx = s.target.x - s.x;
            const dy = s.target.y - s.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 2) {
              const speed = 0.6;
              let nx = s.x + (dx / dist) * speed;
              let ny = s.y + (dy / dist) * speed;
              // Clamp movement to room bounds
              const clamped = clampToRoom(nx, ny, room);
              nx = clamped.x;
              ny = clamped.y;

              // Desk collision avoidance: if next position is inside a desk, steer around it
              if (isInsideAnyObstacle(nx, ny, obstacles, 6)) {
                // Try sliding along X or Y axis only
                const cx = clampToRoom(s.x + (dx > 0 ? speed : -speed), s.y, room);
                const cy = clampToRoom(s.x, s.y + (dy > 0 ? speed : -speed), room);
                if (!isInsideAnyObstacle(cx.x, cx.y, obstacles, 6)) {
                  nx = cx.x; ny = cx.y;
                } else if (!isInsideAnyObstacle(cy.x, cy.y, obstacles, 6)) {
                  nx = cy.x; ny = cy.y;
                } else {
                  // Stuck — just stay put
                  nx = s.x; ny = s.y;
                }
              }

              s.x = nx;
              s.y = ny;
              s.direction = dx > 0 ? 1 : -1;
            } else {
              // Reached destination — go back to seat (no second wander)
              s.target = { x: s.seatX, y: s.seatY };
            }
          }
        }
      });
    });

    // Build output
    const result = {};
    for (const key in state) {
      result[key] = {
        x: state[key].x,
        y: state[key].y,
        direction: state[key].direction,
        sitting: state[key].sitting,
      };
    }
    return result;
  }, [rooms, frame]);

  return positions;
}

// ===== Main Component =====
export default function PixelOffice({ embedded, groupChat, members: filterMembers }) {
  const { company, fetchMessages, setChatOpen, setChatMinimized } = useStore();
  const { t } = useI18n();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const frameRef = useRef(0);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });
  const [hoveredAgent, setHoveredAgent] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [chatBubbles, setChatBubbles] = useState({});
  const [zoom, setZoom] = useState(1);
  const animRef = useRef(null);
  const [frame, setFrame] = useState(0);

  const allDepartments = company?.departments || [];
  const secretary = company?.secretary;
  const boss = company?.boss ? { name: company.boss } : null;

  // In embedded mode with filterMembers, only show departments that have matching members
  const departments = useMemo(() => {
    if (!embedded || !filterMembers?.length) return allDepartments;
    const memberIds = new Set(filterMembers.map(m => m.id));
    return allDepartments
      .map(dept => ({
        ...dept,
        members: (dept.members || []).filter(m => memberIds.has(m.id)),
      }))
      .filter(dept => dept.members.length > 0);
  }, [embedded, filterMembers, allDepartments]);

  const { rooms, totalH } = useMemo(
    () => calculateRoomLayout(departments, canvasSize.w / zoom, secretary, embedded ? null : boss),
    [departments, canvasSize.w, zoom, secretary, embedded, boss]
  );

  const positions = useAgentPositions(rooms, frame);

  // Chat bubbles: from groupChat (embedded) or fetchMessages (standalone)
  // Bubbles auto-disappear after 30 seconds
  const prevGroupChatLenRef = useRef(0);
  useEffect(() => {
    if (embedded && groupChat?.length) {
      // Build bubbles from groupChat messages, with timestamps for auto-disappear
      const now = Date.now();
      const bubbles = {};
      // Process all messages, keep latest per sender
      for (const msg of groupChat) {
        const senderId = msg.from?.id || msg.from;
        const content = msg.content || msg.text;
        if (!senderId || !content || senderId === 'boss' || msg.type === 'system') continue;
        const msgTime = msg.timestamp || msg.time || new Date().toISOString();
        if (!bubbles[senderId] || new Date(msgTime) > new Date(bubbles[senderId].time)) {
          bubbles[senderId] = {
            text: content.replace(/\n/g, ' ').slice(0, 40),
            time: msgTime,
            showUntil: new Date(msgTime).getTime() + 30000, // 30s display
          };
        }
      }
      setChatBubbles(bubbles);
    }
  }, [embedded, groupChat?.length]);

  // Auto-refresh bubbles from fetchMessages in standalone mode
  useEffect(() => {
    if (embedded) return;
    const loadBubbles = async () => {
      try {
        const msgs = await fetchMessages(30);
        if (!msgs) return;
        const bubbles = {};
        for (const msg of msgs) {
          const senderId = msg.from;
          if (senderId && msg.content) {
            const msgTime = msg.timestamp || msg.time;
            if (!bubbles[senderId] || new Date(msgTime) > new Date(bubbles[senderId].time)) {
              bubbles[senderId] = {
                text: msg.content.replace(/\n/g, ' ').slice(0, 40),
                time: msgTime,
              };
            }
          }
        }
        setChatBubbles(bubbles);
      } catch (e) { /* ignore */ }
    };

    loadBubbles();
    const iv = setInterval(loadBubbles, 15000);
    return () => clearInterval(iv);
  }, [fetchMessages, embedded]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setCanvasSize(prev => ({ ...prev, w: Math.max(600, w) }));
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setCanvasSize(prev => ({ ...prev, h: Math.max(400, totalH) }));
  }, [totalH]);

  // Animation loop
  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      frameRef.current += 1;
      if (frameRef.current % 2 === 0) {
        setFrame(frameRef.current);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  // ===== Main canvas drawing =====
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvasSize.w;
    const h = canvasSize.h;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w / zoom, h / zoom);

    // Subtle grid pattern
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    const gridSize = 16;
    for (let gx = 0; gx < w / zoom; gx += gridSize) {
      for (let gy = 0; gy < h / zoom; gy += gridSize) {
        if ((Math.floor(gx / gridSize) + Math.floor(gy / gridSize)) % 2 === 0) {
          ctx.fillRect(gx, gy, gridSize, gridSize);
        }
      }
    }

    const s = 3; // pixel scale (higher quality)

    // Draw rooms
    rooms.forEach((room) => {
      const p = room.palette;
      const seed = hashStr(room.id);

      // Boss office has its own luxury rendering
      if (room.isBoss) {
        drawBossRoom(ctx, room, s);
        return;
      }

      // Floor
      ctx.fillStyle = p.floor;
      ctx.fillRect(room.x, room.y, room.w, room.h);

      // Floor tile pattern
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      const tileSize = 16;
      for (let tx = room.x; tx < room.x + room.w; tx += tileSize) {
        for (let ty = room.y; ty < room.y + room.h; ty += tileSize) {
          if ((Math.floor((tx - room.x) / tileSize) + Math.floor((ty - room.y) / tileSize)) % 2 === 0) {
            ctx.fillRect(tx, ty, tileSize, tileSize);
          }
        }
      }

      // Rug in center area (scale with room width)
      const rugColors = ['rgba(139,69,19,0.2)', 'rgba(70,130,70,0.2)', 'rgba(100,100,160,0.2)', 'rgba(160,100,100,0.2)'];
      const rugW = Math.min(90, room.w - 40);
      const rugH = Math.min(50, room.h - 80);
      if (rugW > 40 && rugH > 20) {
        drawRug(ctx, room.x + room.w / 2 - rugW / 2, room.y + room.h - rugH - 15, rugW, rugH, rugColors[seed % rugColors.length]);
      }

      // Walls (thicker for scale 3)
      ctx.fillStyle = p.wall;
      ctx.fillRect(room.x, room.y - 22, room.w, 22);
      ctx.fillStyle = p.wallTop;
      ctx.fillRect(room.x, room.y - 28, room.w, 6);
      ctx.fillStyle = p.wall;
      ctx.fillRect(room.x - 6, room.y - 28, 6, room.h + 34);
      ctx.fillStyle = p.wall;
      ctx.fillRect(room.x + room.w, room.y - 28, 6, room.h + 34);
      ctx.fillStyle = p.wall;
      ctx.fillRect(room.x - 6, room.y + room.h, room.w + 12, 6);

      // Door (bottom center, bigger)
      ctx.fillStyle = '#5A3A1A';
      ctx.fillRect(room.x + room.w / 2 - 12, room.y + room.h - 3, 24, 9);
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(room.x + room.w / 2 - 10, room.y + room.h, 20, 6);
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(room.x + room.w / 2 + 5, room.y + room.h + 2, 3, 3);

      // === Wall decorations (adaptive) ===
      if (room.w > 250) {
        drawWindow(ctx, room.x + room.w - 70, room.y - 20, s * 0.8);
      }
      if (room.w > 180) {
        drawClock(ctx, room.x + 14, room.y - 20, s * 0.9);
      } else {
        drawClock(ctx, room.x + 10, room.y - 18, s * 0.6);
      }
      if (seed % 3 === 0 && room.w > 300) {
        drawPictureFrame(ctx, room.x + room.w / 2 - 12, room.y - 20, s * 0.7);
      }
      const lampCount = Math.max(1, Math.floor(room.w / 200));
      const lampSpacing = room.w / (lampCount + 1);
      for (let li = 0; li < lampCount; li++) {
        drawHangingLamp(ctx, room.x + lampSpacing * (li + 1), room.y + 4, s * (room.w < 280 ? 0.6 : 0.8));
      }

      // Room name sign (adaptive width)
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const labelMaxW = Math.min(room.w - 20, 220);
      roundRect(ctx, room.x + 8, room.y - 25, labelMaxW, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#FFE4B5';
      ctx.font = `bold ${room.w < 280 ? 10 : 12}px "Courier New", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const maxChars = Math.floor(labelMaxW / 8);
      const roomLabel = room.name.length > maxChars ? room.name.slice(0, maxChars - 1) + '…' : room.name;
      ctx.fillText(roomLabel, room.x + 14, room.y - 16);

      // === Desk pairs ===
      const { seats } = getSeatPositions(room);
      const drawnPairs = new Set();
      seats.forEach(seat => {
        const pairKey = `${seat.deskX},${seat.deskY}`;
        if (!drawnPairs.has(pairKey)) {
          drawnPairs.add(pairKey);
          if (room.id === '__secretary__') {
            drawDesk(ctx, seat.deskX, seat.deskY, s);
          } else if (room.id !== '__boss__') {
            drawDeskPair(ctx, seat.deskX, seat.deskY, s);
          }
        }
      });

      // === Room decorations (adaptive to room size) ===
      if (room.id === '__boss__') return;
      const isSmallRoom = room.w < 300;
      const rightEdge = room.x + room.w - (isSmallRoom ? 20 : 40);
      const decoScale = isSmallRoom ? 0.6 : 1;

      // Whiteboard (only in medium+ rooms)
      if (!isSmallRoom && room.id !== '__secretary__' && seed % 2 === 0) {
        drawWhiteboard(ctx, room.x + 8, room.y + 24, s * 0.7);
      }
      // Bookshelf (only in medium+ rooms)
      if (!isSmallRoom && seed % 4 < 2) {
        drawBookshelf(ctx, rightEdge - 6, room.y + 50, s * 0.9 * decoScale);
      }
      // Plant (always, but scale down in small rooms)
      drawPlant(ctx, room.x + room.w - (isSmallRoom ? 16 : 26), room.y + room.h - 30, s * decoScale);
      if (seed % 3 === 0 && !isSmallRoom) {
        drawSmallPlant(ctx, room.x + 10, room.y + room.h - 22, s);
      }
      // Water cooler / coffee machine (skip in small rooms)
      if (!isSmallRoom) {
        if (seed % 5 < 2) {
          drawWaterCooler(ctx, rightEdge, room.y + 30, s);
        } else if (seed % 5 < 4) {
          drawCoffeeMachine(ctx, rightEdge + 3, room.y + 36, s);
        }
      }
      // Printer (only in medium+ rooms)
      if (!isSmallRoom && seed % 3 !== 1 && room.id !== '__secretary__') {
        drawPrinter(ctx, room.x + room.w / 2 + 30, room.y + room.h - 22, s * 0.9);
      }
      // Trash bin (always)
      drawTrashBin(ctx, room.x + (isSmallRoom ? 4 : 10), room.y + room.h - 24, s * 0.7);
      // File cabinet (skip in small rooms)
      if (!isSmallRoom && room.id !== '__secretary__' && seed % 3 === 1) {
        drawFileCabinet(ctx, room.x + 8, room.y + 50, s * 0.8);
      }
      if (room.id === '__secretary__' && room.w > 200) {
        drawCouch(ctx, room.x + room.w - 80, room.y + room.h - 40, s * 0.7);
      }
    });

    // Draw hallway paths between rooms
    ctx.fillStyle = 'rgba(139,115,85,0.3)';
    for (let i = 1; i < rooms.length; i++) {
      const from = rooms[i - 1];
      const to = rooms[i];
      const fromDoorX = from.x + from.w / 2;
      const fromDoorY = from.y + from.h + 4;
      const toDoorX = to.x + to.w / 2;
      const toDoorY = to.y - 20;

      const midY = (fromDoorY + toDoorY) / 2;
      ctx.fillRect(fromDoorX - 8, fromDoorY, 16, midY - fromDoorY);
      ctx.fillRect(Math.min(fromDoorX, toDoorX) - 8, midY - 4, Math.abs(toDoorX - fromDoorX) + 16, 8);
      ctx.fillRect(toDoorX - 8, midY, 16, toDoorY - midY);
    }

    // Draw characters (sorted by Y for proper overlap)
    const allAgents = [];
    rooms.forEach(room => {
      room.members.forEach(member => {
        const pos = positions[member.id];
        if (!pos) return;
        allAgents.push({ ...member, x: pos.x, y: pos.y, direction: pos.direction, sitting: pos.sitting, roomId: room.id });
      });
    });

    allAgents.sort((a, b) => a.y - b.y);

    allAgents.forEach(agent => {
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(agent.x, agent.y + (agent.sitting ? 3 : 6) * s, 5 * s, 2.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      // Character
      drawPixelChar(ctx, agent.x, agent.y, agent.name, s, frameRef.current, agent.direction, agent.sitting);

      // Name tag (bigger font)
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.font = '10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const nameTag = agent.name.length > 12 ? agent.name.slice(0, 11) + '…' : agent.name;
      const nameW = ctx.measureText(nameTag).width + 8;
      const nameY = agent.sitting ? agent.y + 4 * s : agent.y + 7 * s;
      roundRect(ctx, agent.x - nameW / 2, nameY, nameW, 14, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(nameTag, agent.x, nameY + 2);

      // Chat bubble
      const bubble = chatBubbles[agent.id];
      if (bubble) {
        const now = Date.now();
        const showBubble = bubble.showUntil
          ? now < bubble.showUntil // embedded: auto-disappear after showUntil
          : (now - new Date(bubble.time).getTime()) / 1000 < 300; // standalone: 5min
        if (showBubble) {
          drawBubble(ctx, agent.x, agent.y - 8 * s, bubble.text, s);
        }
      }

      // Hover highlight
      if (hoveredAgent === agent.id) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 2;
        ctx.strokeRect(agent.x - 6 * s, agent.y - 8 * s, 12 * s, 16 * s);
      }

      // Selected highlight
      if (selectedAgent === agent.id) {
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(agent.x - 7 * s, agent.y - 9 * s, 14 * s, 18 * s);
        ctx.setLineDash([]);
      }
    });

    // Title
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, (w / zoom) / 2 - 140, 4, 280, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#FFE4B5';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🏢 ${company?.name || 'AI Enterprise'} — ${t('pixelOffice.title')}`, (w / zoom) / 2, 17);

  }, [rooms, positions, frame, canvasSize, chatBubbles, hoveredAgent, selectedAgent, zoom, company?.name, embedded, t]);

  // Mouse interaction
  const handleCanvasClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / zoom;
    const my = (e.clientY - rect.top) / zoom;
    const s = 3;

    let clicked = null;
    rooms.forEach(room => {
      room.members.forEach(member => {
        if (member.id === '__boss__') return; // boss is not clickable
        const pos = positions[member.id];
        if (!pos) return;
        if (mx >= pos.x - 8 * s && mx <= pos.x + 8 * s && my >= pos.y - 10 * s && my <= pos.y + 10 * s) {
          clicked = member;
        }
      });
    });

    if (clicked?.id === '__secretary__') {
      // Open the bottom-right chat panel with secretary
      setChatOpen(true);
      setChatMinimized(false);
      return;
    }

    setSelectedAgent(clicked?.id || null);
  }, [rooms, positions, zoom, setChatOpen, setChatMinimized]);

  const handleCanvasMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / zoom;
    const my = (e.clientY - rect.top) / zoom;
    const s = 3;

    let found = null;
    rooms.forEach(room => {
      room.members.forEach(member => {
        if (member.id === '__boss__') return; // boss is not interactive
        const pos = positions[member.id];
        if (!pos) return;
        if (mx >= pos.x - 8 * s && mx <= pos.x + 8 * s && my >= pos.y - 10 * s && my <= pos.y + 10 * s) {
          found = member.id;
        }
      });
    });

    setHoveredAgent(found);
    if (canvas) canvas.style.cursor = found ? 'pointer' : 'default';
  }, [rooms, positions, zoom]);

  return (
    <div className={`h-full flex flex-col bg-[#0d0d14] ${embedded ? '' : 'py-2'}`}>
      {/* Toolbar */}
      {!embedded && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[#0d0d0d]">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold text-[#FFE4B5]" style={{ fontFamily: '"Courier New", monospace' }}>
              🏢 {t('pixelOffice.title')}
            </h1>
            <span className="text-xs text-[var(--muted)]" style={{ fontFamily: '"Courier New", monospace' }}>
              {departments.length} {t('pixelOffice.depts')} · {departments.reduce((s, d) => s + (d.members?.length || 0), 0)} {t('pixelOffice.agents')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
              className="px-2 py-1 text-xs bg-[var(--card)] border border-[var(--border)] rounded hover:bg-[var(--card-hover)] transition-colors"
              style={{ fontFamily: '"Courier New", monospace' }}
            >
              ➖
            </button>
            <span className="text-xs text-[var(--muted)] min-w-[40px] text-center" style={{ fontFamily: '"Courier New", monospace' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(2, z + 0.25))}
              className="px-2 py-1 text-xs bg-[var(--card)] border border-[var(--border)] rounded hover:bg-[var(--card-hover)] transition-colors"
              style={{ fontFamily: '"Courier New", monospace' }}
            >
              ➕
            </button>
          </div>
        </div>
      )}

      {/* Canvas area (full width now, no sidebar) */}
      <div ref={containerRef} className="flex-1 overflow-auto relative">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
          className="block"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Legend */}
      {!embedded && (
        <div className="px-4 py-2 border-t border-[var(--border)] bg-[#0d0d0d] flex items-center gap-4 text-xs text-[var(--muted)]" style={{ fontFamily: '"Courier New", monospace' }}>
          <span>🖱️ {t('pixelOffice.clickAgent')}</span>
          <span>💬 {t('pixelOffice.bubbleHint')}</span>
          <span>🚶 {t('pixelOffice.walkHint')}</span>
        </div>
      )}

      {/* Agent Detail Modal (reuses existing component) */}
      {selectedAgent && selectedAgent !== '__secretary__' && selectedAgent !== '__boss__' && (
        <AgentDetailModal agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}

