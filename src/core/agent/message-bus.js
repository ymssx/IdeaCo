/**
 * Agent Message Communication Bus
 * 
 * Agents communicate through the message bus:
 * - Superiors assign tasks to subordinates
 * - Subordinates report results to superiors
 * - Peers collaborate and exchange information
 * - Broadcast messages to entire department
 */
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'eventemitter3';
import { hookRegistry, HookEvent } from '../../lib/hooks.js';

/**
 * Message Types
 */
export const MessageType = {
  TASK: 'task',           // Task assignment
  REPORT: 'report',       // Work report
  QUESTION: 'question',   // Question / consultation
  REVIEW: 'review',       // Code / deliverable review
  FEEDBACK: 'feedback',   // Feedback
  BROADCAST: 'broadcast', // Broadcast notification
};

/**
 * Message Structure
 */
export class Message {
  constructor({ from, to, content, type = MessageType.TASK, metadata = {} }) {
    this.id = uuidv4();
    this.from = from;         // Sender Agent ID
    this.to = to;             // Receiver Agent ID (null = broadcast)
    this.content = content;   // Message content
    this.type = type;         // Message type
    this.metadata = metadata; // Extra data (e.g. task info, file paths, etc.)
    this.timestamp = new Date();
    this.status = 'sent';     // sent | delivered | read | replied
  }

  toJSON() {
    return {
      id: this.id,
      from: this.from,
      to: this.to,
      content: this.content,
      type: this.type,
      metadata: this.metadata,
      timestamp: this.timestamp,
      status: this.status,
    };
  }
}

/**
 * Message Bus - Manages all inter-Agent communication
 */
export class MessageBus extends EventEmitter {
  constructor() {
    super();
    // History of all messages
    this.messages = [];
    // Per-Agent message queue: agentId => Message[]
    this.inbox = new Map();
    // Max history message count
    this.maxHistory = 1000;
  }

  /**
   * Send a message
   * @param {object} params - Message parameters
   * @returns {Message}
   */
  send(params) {
    const message = new Message(params);
    this.messages.push(message);

    // Control history size
    if (this.messages.length > this.maxHistory) {
      this.messages = this.messages.slice(-this.maxHistory);
    }

    // Deliver to target Agent's inbox
    if (message.to) {
      if (!this.inbox.has(message.to)) {
        this.inbox.set(message.to, []);
      }
      this.inbox.get(message.to).push(message);
      // Trigger message event for specific Agent
      this.emit(`message:${message.to}`, message);
    }

    // Trigger global message event
    this.emit('message', message);

    // Fire hook: message sent
    hookRegistry.trigger(HookEvent.MESSAGE_SENT, {
      messageId: message.id, from: message.from, to: message.to,
      type: message.type,
    });

    return message;
  }

  /**
   * Broadcast a message to a group of Agents
   * @param {string} fromAgentId - Sender
   * @param {string[]} targetIds - Receiver list
   * @param {string} content - Message content
   * @param {string} type - Message type
   */
  broadcast(fromAgentId, targetIds, content, type = MessageType.BROADCAST) {
    const messages = [];
    for (const targetId of targetIds) {
      const msg = this.send({
        from: fromAgentId,
        to: targetId,
        content,
        type,
      });
      messages.push(msg);
    }
    return messages;
  }

  /**
   * Get unread messages for an Agent
   */
  getInbox(agentId) {
    return this.inbox.get(agentId) || [];
  }

  /**
   * Get pending messages for an Agent (unreplied)
   */
  getPending(agentId) {
    const inbox = this.getInbox(agentId);
    return inbox.filter(m => m.status !== 'replied');
  }

  /**
   * Mark a message as read
   */
  markRead(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) msg.status = 'read';
  }

  /**
   * Mark a message as replied
   */
  markReplied(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) msg.status = 'replied';
  }

  /**
   * Get conversation history between two Agents
   */
  getConversation(agentId1, agentId2, limit = 50) {
    return this.messages
      .filter(m =>
        (m.from === agentId1 && m.to === agentId2) ||
        (m.from === agentId2 && m.to === agentId1)
      )
      .slice(-limit);
  }

  /**
   * Get all communication records for an Agent
   */
  getAgentHistory(agentId, limit = 50) {
    return this.messages
      .filter(m => m.from === agentId || m.to === agentId)
      .slice(-limit);
  }

  /**
   * Get global message statistics
   */
  getStats() {
    const stats = {
      totalMessages: this.messages.length,
      byType: {},
      activeAgents: new Set(),
    };

    for (const msg of this.messages) {
      stats.byType[msg.type] = (stats.byType[msg.type] || 0) + 1;
      if (msg.from) stats.activeAgents.add(msg.from);
      if (msg.to) stats.activeAgents.add(msg.to);
    }
    stats.activeAgents = stats.activeAgents.size;

    return stats;
  }

  /**
   * Get recent messages (for UI display)
   */
  getRecent(limit = 20) {
    return this.messages.slice(-limit).map(m => m.toJSON());
  }

  /**
   * Clear a specific Agent's inbox
   */
  clearInbox(agentId) {
    this.inbox.set(agentId, []);
  }
}
