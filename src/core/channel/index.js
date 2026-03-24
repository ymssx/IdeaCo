/**
 * Channel Module - Extensible multi-channel messaging system
 *
 * Architecture overview:
 * ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
 * │   WeChat    │   │  Telegram   │   │   Slack     │  ... more channels
 * │  Adapter    │   │  Adapter    │   │  Adapter    │
 * └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
 *        │                 │                 │
 *        └────────┬────────┴────────┬────────┘
 *                 │                 │
 *          ┌──────▼──────┐  ┌──────▼──────┐
 *          │  Channel    │  │  Base       │
 *          │  Registry   │  │  Channel    │
 *          └──────┬──────┘  └─────────────┘
 *                 │
 *          ┌──────▼──────┐
 *          │  Company    │  (Secretary handles messages)
 *          └─────────────┘
 *
 * Adding a new channel requires only:
 * 1. Create an adapter class extending BaseChannel
 * 2. Register the adapter in this file
 * 3. Done!
 */

// Infrastructure
export { BaseChannel, ChannelState, InboundMessage, OutboundMessage } from './base-channel.js';
export { ChannelRegistry, channelRegistry } from './channel-registry.js';

// Built-in adapters
export { WeixinChannel } from './adapters/weixin.js';

// ─── Auto-register built-in adapters ─────────────────────────

import { channelRegistry } from './channel-registry.js';
import { WeixinChannel } from './adapters/weixin.js';

// Register WeChat adapter (declared as available, not auto-installed/connected)
channelRegistry.registerAdapter('weixin', WeixinChannel);

// ─── Future extension examples ───────────────────────────────
// import { TelegramChannel } from './adapters/telegram.js';
// channelRegistry.registerAdapter('telegram', TelegramChannel);
//
// import { SlackChannel } from './adapters/slack.js';
// channelRegistry.registerAdapter('slack', SlackChannel);
//
// import { DiscordChannel } from './adapters/discord.js';
// channelRegistry.registerAdapter('discord', DiscordChannel);
