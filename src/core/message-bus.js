/**
 * Agent消息通信总线
 * 
 * Agent之间通过消息总线进行通信：
 * - 上级分配任务给下级
 * - 下级向上级汇报结果
 * - 同级之间协作交流
 * - 广播消息给整个部门
 */
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'eventemitter3';

/**
 * 消息类型
 */
export const MessageType = {
  TASK: 'task',           // 任务分配
  REPORT: 'report',       // 工作汇报
  QUESTION: 'question',   // 提问咨询
  REVIEW: 'review',       // 代码/成果审查
  FEEDBACK: 'feedback',   // 反馈意见
  BROADCAST: 'broadcast', // 广播通知
};

/**
 * 消息结构
 */
export class Message {
  constructor({ from, to, content, type = MessageType.TASK, metadata = {} }) {
    this.id = uuidv4();
    this.from = from;         // 发送者 Agent ID
    this.to = to;             // 接收者 Agent ID（null 表示广播）
    this.content = content;   // 消息内容
    this.type = type;         // 消息类型
    this.metadata = metadata; // 额外数据（如任务信息、文件路径等）
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
 * 消息总线 - 管理Agent间的所有通信
 */
export class MessageBus extends EventEmitter {
  constructor() {
    super();
    // 所有消息的历史记录
    this.messages = [];
    // 每个Agent的消息队列 agentId => Message[]
    this.inbox = new Map();
    // 最大历史消息数
    this.maxHistory = 1000;
  }

  /**
   * 发送消息
   * @param {object} params - 消息参数
   * @returns {Message}
   */
  send(params) {
    const message = new Message(params);
    this.messages.push(message);

    // 控制历史记录大小
    if (this.messages.length > this.maxHistory) {
      this.messages = this.messages.slice(-this.maxHistory);
    }

    // 投递到目标Agent的收件箱
    if (message.to) {
      if (!this.inbox.has(message.to)) {
        this.inbox.set(message.to, []);
      }
      this.inbox.get(message.to).push(message);
      // 触发特定Agent的消息事件
      this.emit(`message:${message.to}`, message);
    }

    // 触发全局消息事件
    this.emit('message', message);

    return message;
  }

  /**
   * 广播消息给一组Agent
   * @param {string} fromAgentId - 发送者
   * @param {string[]} targetIds - 接收者列表
   * @param {string} content - 消息内容
   * @param {string} type - 消息类型
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
   * 获取Agent的未读消息
   */
  getInbox(agentId) {
    return this.inbox.get(agentId) || [];
  }

  /**
   * 获取Agent的待处理消息（未回复的）
   */
  getPending(agentId) {
    const inbox = this.getInbox(agentId);
    return inbox.filter(m => m.status !== 'replied');
  }

  /**
   * 标记消息为已读
   */
  markRead(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) msg.status = 'read';
  }

  /**
   * 标记消息为已回复
   */
  markReplied(messageId) {
    const msg = this.messages.find(m => m.id === messageId);
    if (msg) msg.status = 'replied';
  }

  /**
   * 获取两个Agent之间的对话历史
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
   * 获取某个Agent的所有通信记录
   */
  getAgentHistory(agentId, limit = 50) {
    return this.messages
      .filter(m => m.from === agentId || m.to === agentId)
      .slice(-limit);
  }

  /**
   * 获取全局消息统计
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
   * 获取最近的消息（用于 UI 展示）
   */
  getRecent(limit = 20) {
    return this.messages.slice(-limit).map(m => m.toJSON());
  }

  /**
   * 清空特定Agent的收件箱
   */
  clearInbox(agentId) {
    this.inbox.set(agentId, []);
  }
}
