/**
 * Configuration Validator - Schema-based config validation and safe defaults
 *
 * Distilled from OpenClaw's config system (vendor/openclaw/src/config/validation.ts
 * and vendor/openclaw/src/config/schema.ts)
 * Re-implemented as an enterprise "company policy compliance engine"
 *
 * Features:
 * - Declarative schema definition with type checking
 * - Nested object and array validation
 * - Default value injection
 * - Environment variable interpolation
 * - Validation error aggregation with friendly messages
 * - Runtime config patching with safety checks
 * - Config diffing for change tracking
 */

/**
 * Supported config value types
 */
export const ConfigType = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
  ENUM: 'enum',
};

/**
 * Validation error entry
 * @typedef {object} ValidationError
 * @property {string} path - Dot-notation path to the invalid field
 * @property {string} message - Human-readable error message
 * @property {*} value - The invalid value
 * @property {string} rule - Which rule was violated
 */

/**
 * Schema field definition
 * @typedef {object} SchemaField
 * @property {string} type - ConfigType value
 * @property {string} description - Field description
 * @property {*} default - Default value if not provided
 * @property {boolean} required - Whether the field is required
 * @property {Array} enum - Allowed values (for 'enum' type)
 * @property {number} min - Minimum value (for 'number') or min length (for 'string'/'array')
 * @property {number} max - Maximum value (for 'number') or max length (for 'string'/'array')
 * @property {RegExp|string} pattern - Regex pattern (for 'string')
 * @property {object} items - Schema for array items
 * @property {object} properties - Schema for object properties
 * @property {string} envVar - Environment variable to read from
 * @property {Function} validate - Custom validation function: (value) => string|null
 */

/**
 * Validate a value against a schema field definition
 *
 * @param {*} value - Value to validate
 * @param {SchemaField} field - Schema definition
 * @param {string} path - Current dot-notation path (for error messages)
 * @returns {ValidationError[]}
 */
function validateField(value, field, path) {
  const errors = [];

  // Handle required check
  if (value === undefined || value === null) {
    if (field.required) {
      errors.push({ path, message: `Required field "${path}" is missing`, value, rule: 'required' });
    }
    return errors; // No further validation on missing optional fields
  }

  // Type checking
  switch (field.type) {
    case ConfigType.STRING:
      if (typeof value !== 'string') {
        errors.push({ path, message: `"${path}" must be a string, got ${typeof value}`, value, rule: 'type' });
        return errors;
      }
      if (field.min !== undefined && value.length < field.min) {
        errors.push({ path, message: `"${path}" must be at least ${field.min} characters`, value, rule: 'min' });
      }
      if (field.max !== undefined && value.length > field.max) {
        errors.push({ path, message: `"${path}" must be at most ${field.max} characters`, value, rule: 'max' });
      }
      if (field.pattern) {
        const regex = field.pattern instanceof RegExp ? field.pattern : new RegExp(field.pattern);
        if (!regex.test(value)) {
          errors.push({ path, message: `"${path}" does not match required pattern`, value, rule: 'pattern' });
        }
      }
      break;

    case ConfigType.NUMBER:
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push({ path, message: `"${path}" must be a number, got ${typeof value}`, value, rule: 'type' });
        return errors;
      }
      if (field.min !== undefined && value < field.min) {
        errors.push({ path, message: `"${path}" must be >= ${field.min}`, value, rule: 'min' });
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({ path, message: `"${path}" must be <= ${field.max}`, value, rule: 'max' });
      }
      break;

    case ConfigType.BOOLEAN:
      if (typeof value !== 'boolean') {
        errors.push({ path, message: `"${path}" must be a boolean, got ${typeof value}`, value, rule: 'type' });
      }
      break;

    case ConfigType.ENUM:
      if (!field.enum || !field.enum.includes(value)) {
        errors.push({
          path,
          message: `"${path}" must be one of [${(field.enum || []).join(', ')}], got "${value}"`,
          value,
          rule: 'enum',
        });
      }
      break;

    case ConfigType.ARRAY:
      if (!Array.isArray(value)) {
        errors.push({ path, message: `"${path}" must be an array, got ${typeof value}`, value, rule: 'type' });
        return errors;
      }
      if (field.min !== undefined && value.length < field.min) {
        errors.push({ path, message: `"${path}" must have at least ${field.min} items`, value, rule: 'min' });
      }
      if (field.max !== undefined && value.length > field.max) {
        errors.push({ path, message: `"${path}" must have at most ${field.max} items`, value, rule: 'max' });
      }
      // Validate array items
      if (field.items) {
        value.forEach((item, index) => {
          errors.push(...validateField(item, field.items, `${path}[${index}]`));
        });
      }
      break;

    case ConfigType.OBJECT:
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push({ path, message: `"${path}" must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`, value, rule: 'type' });
        return errors;
      }
      // Validate nested properties
      if (field.properties) {
        for (const [key, propSchema] of Object.entries(field.properties)) {
          errors.push(...validateField(value[key], propSchema, `${path}.${key}`));
        }
      }
      break;
  }

  // Custom validation
  if (field.validate && typeof field.validate === 'function') {
    const customError = field.validate(value);
    if (customError) {
      errors.push({ path, message: customError, value, rule: 'custom' });
    }
  }

  return errors;
}

/**
 * Apply default values to a config object based on schema
 *
 * @param {object} config - The config object (will be mutated)
 * @param {object} schema - Schema definition with properties
 * @returns {object} The config with defaults applied
 */
function applyDefaults(config, schema) {
  if (!schema || !schema.properties) return config;

  for (const [key, field] of Object.entries(schema.properties)) {
    if (config[key] === undefined && field.default !== undefined) {
      config[key] = structuredClone(field.default);
    }

    // Apply env var override
    if (field.envVar && process.env[field.envVar] !== undefined) {
      const envValue = process.env[field.envVar];
      switch (field.type) {
        case ConfigType.NUMBER:
          config[key] = Number(envValue);
          break;
        case ConfigType.BOOLEAN:
          config[key] = envValue === 'true' || envValue === '1';
          break;
        default:
          config[key] = envValue;
      }
    }

    // Recurse into nested objects
    if (field.type === ConfigType.OBJECT && field.properties && config[key]) {
      applyDefaults(config[key], field);
    }
  }

  return config;
}

/**
 * Config Validator - Schema-based configuration validation
 */
export class ConfigValidator {
  /**
   * @param {object} schema - Top-level schema definition
   * @param {object} schema.properties - Map of field names to SchemaField definitions
   */
  constructor(schema) {
    this.schema = schema;
  }

  /**
   * Validate a config object against the schema
   *
   * @param {object} config
   * @returns {{ valid: boolean, errors: ValidationError[] }}
   */
  validate(config) {
    if (!config || typeof config !== 'object') {
      return {
        valid: false,
        errors: [{ path: '', message: 'Config must be a non-null object', value: config, rule: 'type' }],
      };
    }

    const errors = [];
    if (this.schema.properties) {
      for (const [key, field] of Object.entries(this.schema.properties)) {
        errors.push(...validateField(config[key], field, key));
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate and apply defaults (non-destructive - returns a new object)
   *
   * @param {object} config
   * @returns {{ valid: boolean, config: object, errors: ValidationError[] }}
   */
  validateAndApplyDefaults(config) {
    const merged = structuredClone(config || {});
    applyDefaults(merged, this.schema);

    const { valid, errors } = this.validate(merged);
    return { valid, config: merged, errors };
  }

  /**
   * Apply a runtime config patch with validation
   *
   * Distilled from OpenClaw's merge-patch.ts pattern — prevents prototype pollution
   * and validates the resulting config.
   *
   * @param {object} baseConfig - Current config
   * @param {object} patch - Partial config to merge
   * @returns {{ valid: boolean, config: object, errors: ValidationError[], changes: Array }}
   */
  applyPatch(baseConfig, patch) {
    if (!patch || typeof patch !== 'object') {
      return {
        valid: true,
        config: structuredClone(baseConfig),
        errors: [],
        changes: [],
      };
    }

    const merged = structuredClone(baseConfig || {});
    const changes = [];

    // Safe merge (prototype pollution prevention)
    for (const [key, value] of Object.entries(patch)) {
      // Block prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }

      const oldValue = merged[key];
      if (value === null) {
        // null means "delete this key"
        if (merged[key] !== undefined) {
          changes.push({ path: key, action: 'delete', oldValue: merged[key] });
          delete merged[key];
        }
      } else if (typeof value === 'object' && !Array.isArray(value) && typeof oldValue === 'object' && !Array.isArray(oldValue)) {
        // Deep merge for nested objects
        const nested = this._deepMergeSafe(oldValue, value, key);
        merged[key] = nested.result;
        changes.push(...nested.changes);
      } else {
        // Direct replacement
        merged[key] = structuredClone(value);
        if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
          changes.push({ path: key, action: oldValue === undefined ? 'add' : 'update', oldValue, newValue: value });
        }
      }
    }

    const { valid, errors } = this.validate(merged);
    return { valid, config: merged, errors, changes };
  }

  /**
   * Deep merge with prototype pollution protection
   * @private
   */
  _deepMergeSafe(target, source, parentPath) {
    const result = { ...target };
    const changes = [];

    for (const [key, value] of Object.entries(source)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }

      const fullPath = `${parentPath}.${key}`;
      const oldValue = result[key];

      if (value === null) {
        if (result[key] !== undefined) {
          changes.push({ path: fullPath, action: 'delete', oldValue: result[key] });
          delete result[key];
        }
      } else if (typeof value === 'object' && !Array.isArray(value) && typeof oldValue === 'object' && !Array.isArray(oldValue)) {
        const nested = this._deepMergeSafe(oldValue, value, fullPath);
        result[key] = nested.result;
        changes.push(...nested.changes);
      } else {
        result[key] = structuredClone(value);
        if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
          changes.push({ path: fullPath, action: oldValue === undefined ? 'add' : 'update', oldValue, newValue: value });
        }
      }
    }

    return { result, changes };
  }

  /**
   * Diff two configs to find changes
   *
   * @param {object} oldConfig
   * @param {object} newConfig
   * @returns {Array<{path: string, action: string, oldValue: *, newValue: *}>}
   */
  diff(oldConfig, newConfig) {
    return this._diffObjects(oldConfig || {}, newConfig || {}, '');
  }

  /**
   * @private
   */
  _diffObjects(oldObj, newObj, prefix) {
    const changes = [];
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const oldVal = oldObj[key];
      const newVal = newObj[key];

      if (oldVal === undefined && newVal !== undefined) {
        changes.push({ path, action: 'add', oldValue: undefined, newValue: newVal });
      } else if (oldVal !== undefined && newVal === undefined) {
        changes.push({ path, action: 'delete', oldValue: oldVal, newValue: undefined });
      } else if (
        typeof oldVal === 'object' && oldVal !== null && !Array.isArray(oldVal) &&
        typeof newVal === 'object' && newVal !== null && !Array.isArray(newVal)
      ) {
        changes.push(...this._diffObjects(oldVal, newVal, path));
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ path, action: 'update', oldValue: oldVal, newValue: newVal });
      }
    }

    return changes;
  }
}

// ============================================================================
// Pre-built schema for the enterprise application config
// ============================================================================

/**
 * Enterprise application config schema
 */
export const enterpriseConfigSchema = {
  properties: {
    company: {
      type: ConfigType.OBJECT,
      description: 'Company configuration',
      required: true,
      properties: {
        name: {
          type: ConfigType.STRING,
          description: 'Company name',
          required: true,
          min: 1,
          max: 100,
        },
        mission: {
          type: ConfigType.STRING,
          description: 'Company mission statement',
          default: '',
        },
      },
    },
    providers: {
      type: ConfigType.ARRAY,
      description: 'LLM provider configurations',
      default: [],
      items: {
        type: ConfigType.OBJECT,
        properties: {
          id: { type: ConfigType.STRING, required: true },
          provider: {
            type: ConfigType.ENUM,
            enum: ['openai', 'anthropic', 'google', 'deepseek', 'qwen', 'zhipu', 'moonshot', 'custom'],
            required: true,
          },
          apiKey: { type: ConfigType.STRING, envVar: 'LLM_API_KEY' },
          model: { type: ConfigType.STRING, default: 'gpt-4o-mini' },
          baseURL: { type: ConfigType.STRING },
          maxTokens: { type: ConfigType.NUMBER, min: 1, max: 200000, default: 4096 },
        },
      },
    },
    session: {
      type: ConfigType.OBJECT,
      description: 'Session management settings',
      default: {},
      properties: {
        maxSessions: { type: ConfigType.NUMBER, min: 1, max: 10000, default: 500 },
        sessionTTL: { type: ConfigType.NUMBER, min: 0, default: 0 },
        idleTimeout: { type: ConfigType.NUMBER, min: 0, default: 1800000 },
        maxTranscriptLength: { type: ConfigType.NUMBER, min: 10, max: 1000, default: 100 },
      },
    },
    security: {
      type: ConfigType.OBJECT,
      description: 'Security settings',
      default: {},
      properties: {
        blockDangerousCommands: { type: ConfigType.BOOLEAN, default: true },
        scanSecrets: { type: ConfigType.BOOLEAN, default: true },
        maxFileSize: { type: ConfigType.NUMBER, min: 1024, default: 1048576 },
        auditLogDir: { type: ConfigType.STRING, default: 'data/audit' },
      },
    },
    cron: {
      type: ConfigType.OBJECT,
      description: 'Scheduler settings',
      default: {},
      properties: {
        enabled: { type: ConfigType.BOOLEAN, default: false },
        tickInterval: { type: ConfigType.NUMBER, min: 1000, default: 60000 },
      },
    },
    hooks: {
      type: ConfigType.OBJECT,
      description: 'Hook system settings',
      default: {},
      properties: {
        enabled: { type: ConfigType.BOOLEAN, default: true },
        handlerTimeout: { type: ConfigType.NUMBER, min: 1000, max: 60000, default: 10000 },
      },
    },
  },
};

// Global singleton with enterprise schema
export const configValidator = new ConfigValidator(enterpriseConfigSchema);
