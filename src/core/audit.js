/**
 * Security Audit System - Enterprise-grade operation logging and access control
 *
 * Distilled from OpenClaw's security module (vendor/openclaw/src/security/)
 * Re-implemented for the AI enterprise simulation context
 *
 * Features:
 * - Audit trail for all tool calls and agent actions
 * - Dangerous command detection and approval workflow
 * - Secret scanning in agent outputs
 * - Permission policies per agent/department
 */
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { AUDIT_DIR } from './paths.js';

/**
 * Audit event severity levels
 */
export const AuditLevel = {
  INFO: 'info',
  WARN: 'warn',
  CRITICAL: 'critical',
};

/**
 * Audit event categories
 */
export const AuditCategory = {
  TOOL_CALL: 'tool_call',
  LLM_REQUEST: 'llm_request',
  FILE_ACCESS: 'file_access',
  SHELL_EXEC: 'shell_exec',
  AGENT_ACTION: 'agent_action',
  AUTH: 'auth',
  CONFIG_CHANGE: 'config_change',
  SECRET_DETECTED: 'secret_detected',
};

/**
 * Dangerous patterns in shell commands
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\s+\//,          // rm -rf /
  /\bsudo\b/,                   // sudo commands
  /\bcurl\b.*\|\s*bash/,        // curl | bash
  /\bwget\b.*\|\s*sh/,          // wget | sh
  /\bchmod\s+777\b/,            // chmod 777
  /\bdd\s+if=/,                 // dd disk operations
  /\bmkfs\b/,                   // filesystem creation
  /\b(shutdown|reboot|halt)\b/, // system shutdown
  /\bkill\s+-9\s+1\b/,         // kill init
  />\s*\/dev\/sd[a-z]/,         // write to disk device
  /\beval\b.*\$\(/,             // eval with command substitution
];

/**
 * Secret patterns for scanning
 */
const SECRET_PATTERNS = [
  { name: 'AWS Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/i },
  { name: 'JWT Token', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'GitHub Token', pattern: /gh[ps]_[a-zA-Z0-9]{36}/ },
  { name: 'OpenAI Key', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Password in URL', pattern: /:\/\/[^:]+:[^@]+@/ },
];

/**
 * Audit Logger - Records all security-relevant events
 */
export class AuditLogger {
  /**
   * @param {object} options
   * @param {string} options.logDir - Directory for audit log files
   * @param {number} options.maxEvents - Max events to keep in memory
   * @param {boolean} options.persistToDisk - Whether to write logs to disk
   * @param {Function} options.onCritical - Callback for critical events
   */
  constructor(options = {}) {
    this.logDir = options.logDir || AUDIT_DIR;
    this.maxEvents = options.maxEvents ?? 1000;
    this.persistToDisk = options.persistToDisk ?? true;
    this.onCritical = options.onCritical || null;

    // In-memory event buffer
    this.events = [];

    // Ensure log directory exists
    if (this.persistToDisk && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Log an audit event
   * @param {object} event
   * @param {string} event.category - Event category (AuditCategory)
   * @param {string} event.level - Severity level (AuditLevel)
   * @param {string} event.agentId - Agent that triggered the event
   * @param {string} event.agentName - Agent name
   * @param {string} event.action - Description of the action
   * @param {object} event.details - Additional event details
   * @param {boolean} event.blocked - Whether the action was blocked
   * @returns {object} The logged event
   */
  log(event) {
    const auditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      category: event.category || AuditCategory.AGENT_ACTION,
      level: event.level || AuditLevel.INFO,
      agentId: event.agentId || 'system',
      agentName: event.agentName || 'System',
      action: event.action || '',
      details: event.details || {},
      blocked: event.blocked || false,
    };

    // Add to in-memory buffer
    this.events.push(auditEvent);
    if (this.events.length > this.maxEvents) {
      this.events.shift(); // Remove oldest
    }

    // Persist to disk
    if (this.persistToDisk) {
      this._persistEvent(auditEvent);
    }

    // Critical event callback
    if (auditEvent.level === AuditLevel.CRITICAL && this.onCritical) {
      try { this.onCritical(auditEvent); } catch {}
    }

    // Console output for critical/warn
    if (auditEvent.level === AuditLevel.CRITICAL) {
      console.error(`🚨 [AUDIT CRITICAL] ${auditEvent.action}`, auditEvent.details);
    } else if (auditEvent.level === AuditLevel.WARN) {
      console.warn(`⚠️  [AUDIT WARN] ${auditEvent.action}`);
    }

    return auditEvent;
  }

  /**
   * Persist event to daily log file
   */
  _persistEvent(event) {
    try {
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const logFile = path.join(this.logDir, `audit-${date}.jsonl`);
      fs.appendFileSync(logFile, JSON.stringify(event) + '\n', 'utf-8');
    } catch (err) {
      console.error('[AuditLogger] Failed to persist event:', err.message);
    }
  }

  /**
   * Query events with filters
   * @param {object} filters
   * @param {string} filters.category
   * @param {string} filters.level
   * @param {string} filters.agentId
   * @param {boolean} filters.blocked
   * @param {number} filters.limit
   * @returns {Array} Matching events
   */
  query(filters = {}) {
    let results = [...this.events];

    if (filters.category) results = results.filter(e => e.category === filters.category);
    if (filters.level) results = results.filter(e => e.level === filters.level);
    if (filters.agentId) results = results.filter(e => e.agentId === filters.agentId);
    if (filters.blocked !== undefined) results = results.filter(e => e.blocked === filters.blocked);

    // Most recent first
    results.reverse();

    if (filters.limit) results = results.slice(0, filters.limit);

    return results;
  }

  /**
   * Get audit summary statistics
   * @returns {object}
   */
  getSummary() {
    const total = this.events.length;
    const byLevel = { info: 0, warn: 0, critical: 0 };
    const byCategory = {};
    let blocked = 0;

    for (const event of this.events) {
      byLevel[event.level] = (byLevel[event.level] || 0) + 1;
      byCategory[event.category] = (byCategory[event.category] || 0) + 1;
      if (event.blocked) blocked++;
    }

    return { total, byLevel, byCategory, blocked };
  }

  /**
   * Clear in-memory events
   */
  clear() {
    this.events = [];
  }
}

/**
 * Security Guard - Validates actions before execution
 */
export class SecurityGuard {
  /**
   * @param {AuditLogger} auditLogger
   * @param {object} options
   * @param {boolean} options.blockDangerous - Whether to block dangerous commands
   * @param {boolean} options.scanSecrets - Whether to scan for secrets
   * @param {Array} options.allowedCommands - Whitelist of allowed shell commands
   */
  constructor(auditLogger, options = {}) {
    this.audit = auditLogger;
    this.blockDangerous = options.blockDangerous ?? true;
    this.scanSecrets = options.scanSecrets ?? true;
    this.allowedCommands = options.allowedCommands || [
      'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
      'node', 'npm', 'npx', 'echo', 'mkdir', 'cp', 'mv',
      'tree', 'pwd', 'which', 'git',
      'curl', 'wget', 'date', 'python', 'python3', 'env', 'sort', 'uniq', 'awk', 'sed', 'jq',
    ];

    // Per-agent permission policies
    // { agentId: { canExecShell, canWriteFiles, canAccessNetwork, ... } }
    this.policies = new Map();
  }

  /**
   * Set permission policy for an agent
   * @param {string} agentId
   * @param {object} policy
   */
  setPolicy(agentId, policy) {
    this.policies.set(agentId, {
      canExecShell: true,
      canWriteFiles: true,
      canDeleteFiles: false,
      canAccessNetwork: false,
      canSendMessages: true,
      maxFileSize: 1024 * 1024, // 1MB
      ...policy,
    });
  }

  /**
   * Get policy for an agent (default permissive)
   * @param {string} agentId
   * @returns {object}
   */
  getPolicy(agentId) {
    return this.policies.get(agentId) || {
      canExecShell: true,
      canWriteFiles: true,
      canDeleteFiles: false,
      canAccessNetwork: false,
      canSendMessages: true,
      maxFileSize: 1024 * 1024,
    };
  }

  /**
   * Validate a shell command before execution
   * @param {string} command
   * @param {string} agentId
   * @param {string} agentName
   * @returns {{ allowed: boolean, reason?: string }}
   */
  validateShellCommand(command, agentId, agentName = '') {
    const policy = this.getPolicy(agentId);

    // Check policy permission
    if (!policy.canExecShell) {
      this.audit.log({
        category: AuditCategory.SHELL_EXEC,
        level: AuditLevel.WARN,
        agentId,
        agentName,
        action: `Shell execution denied by policy: ${command}`,
        details: { command },
        blocked: true,
      });
      return { allowed: false, reason: 'Agent does not have shell execution permission' };
    }

    // Check command whitelist
    const cmdName = command.trim().split(/\s+/)[0];
    if (!this.allowedCommands.includes(cmdName)) {
      this.audit.log({
        category: AuditCategory.SHELL_EXEC,
        level: AuditLevel.WARN,
        agentId,
        agentName,
        action: `Command not in whitelist: ${cmdName}`,
        details: { command, cmdName },
        blocked: true,
      });
      return { allowed: false, reason: `Command "${cmdName}" is not in the allowed list` };
    }

    // Check dangerous patterns
    if (this.blockDangerous) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
          this.audit.log({
            category: AuditCategory.SHELL_EXEC,
            level: AuditLevel.CRITICAL,
            agentId,
            agentName,
            action: `Dangerous command blocked: ${command}`,
            details: { command, matchedPattern: pattern.toString() },
            blocked: true,
          });
          return { allowed: false, reason: `Dangerous command pattern detected` };
        }
      }
    }

    // Log approved command
    this.audit.log({
      category: AuditCategory.SHELL_EXEC,
      level: AuditLevel.INFO,
      agentId,
      agentName,
      action: `Shell command approved: ${command}`,
      details: { command },
      blocked: false,
    });

    return { allowed: true };
  }

  /**
   * Validate file write operation
   * @param {string} filePath
   * @param {string} content
   * @param {string} agentId
   * @param {string} agentName
   * @returns {{ allowed: boolean, reason?: string }}
   */
  validateFileWrite(filePath, content, agentId, agentName = '') {
    const policy = this.getPolicy(agentId);

    if (!policy.canWriteFiles) {
      this.audit.log({
        category: AuditCategory.FILE_ACCESS,
        level: AuditLevel.WARN,
        agentId,
        agentName,
        action: `File write denied by policy: ${filePath}`,
        details: { filePath },
        blocked: true,
      });
      return { allowed: false, reason: 'Agent does not have file write permission' };
    }

    // Check file size
    const size = Buffer.byteLength(content, 'utf-8');
    if (size > policy.maxFileSize) {
      this.audit.log({
        category: AuditCategory.FILE_ACCESS,
        level: AuditLevel.WARN,
        agentId,
        agentName,
        action: `File too large: ${filePath} (${size} bytes)`,
        details: { filePath, size, maxSize: policy.maxFileSize },
        blocked: true,
      });
      return { allowed: false, reason: `File size (${size} bytes) exceeds limit (${policy.maxFileSize} bytes)` };
    }

    this.audit.log({
      category: AuditCategory.FILE_ACCESS,
      level: AuditLevel.INFO,
      agentId,
      agentName,
      action: `File write: ${filePath} (${size} bytes)`,
      details: { filePath, size },
    });

    return { allowed: true };
  }

  /**
   * Scan text for secrets/credentials
   * @param {string} text - Text to scan
   * @param {string} context - Where the text came from
   * @param {string} agentId
   * @returns {{ clean: boolean, findings: Array }}
   */
  scanForSecrets(text, context = '', agentId = 'system') {
    if (!this.scanSecrets || !text) return { clean: true, findings: [] };

    const findings = [];

    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          type: name,
          position: match.index,
          preview: match[0].slice(0, 8) + '***',
        });
      }
    }

    if (findings.length > 0) {
      this.audit.log({
        category: AuditCategory.SECRET_DETECTED,
        level: AuditLevel.CRITICAL,
        agentId,
        action: `Secrets detected in ${context}: ${findings.map(f => f.type).join(', ')}`,
        details: { context, findings },
        blocked: false, // Log but don't block - leave decision to caller
      });
    }

    return { clean: findings.length === 0, findings };
  }

  /**
   * Log a tool call
   * @param {string} toolName
   * @param {object} args
   * @param {string} agentId
   * @param {string} agentName
   */
  logToolCall(toolName, args, agentId, agentName = '') {
    this.audit.log({
      category: AuditCategory.TOOL_CALL,
      level: AuditLevel.INFO,
      agentId,
      agentName,
      action: `Tool call: ${toolName}`,
      details: { toolName, args: this._sanitizeArgs(args) },
    });
  }

  /**
   * Log an LLM API request
   */
  logLLMRequest(providerId, model, tokenCount, agentId, agentName = '') {
    this.audit.log({
      category: AuditCategory.LLM_REQUEST,
      level: AuditLevel.INFO,
      agentId,
      agentName,
      action: `LLM request: ${providerId} (${model})`,
      details: { providerId, model, tokenCount },
    });
  }

  /**
   * Sanitize arguments for logging (remove sensitive data)
   */
  _sanitizeArgs(args) {
    if (!args || typeof args !== 'object') return args;
    const sanitized = { ...args };
    const sensitiveKeys = ['apiKey', 'password', 'token', 'secret', 'credential'];
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '***REDACTED***';
      }
    }
    return sanitized;
  }
}

// Global singletons
export const auditLogger = new AuditLogger();
export const securityGuard = new SecurityGuard(auditLogger);
