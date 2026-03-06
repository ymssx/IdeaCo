import { NextResponse } from 'next/server';
import { auditLogger, securityGuard } from '@/core/audit.js';
import { providerRouter } from '@/core/provider-router.js';
import { pluginRegistry } from '@/core/plugin.js';
import { cronScheduler } from '@/core/cron.js';
import { hookRegistry } from '@/lib/hooks.js';
import { sessionManager } from '@/core/session.js';
import { configValidator } from '@/lib/config-validator.js';

/**
 * GET /api/system/status - System status dashboard
 * Returns health of all distilled systems: audit, routing, plugins, cron, hooks, sessions, config
 */
export async function GET() {
  try {
    const status = {
      // Provider Router health dashboard
      routing: {
        healthDashboard: providerRouter.getHealthDashboard(),
        strategy: providerRouter.strategy,
      },

      // Audit system summary
      audit: auditLogger.getSummary(),

      // Plugin system status
      plugins: pluginRegistry.list(),

      // Cron scheduler status
      cron: cronScheduler.getSummary(),
      cronJobs: cronScheduler.listJobs(),

      // Hook system status
      hooks: hookRegistry.getSummary(),

      // Session manager status
      sessions: sessionManager.getSummary(),

      // Config validator (validate current empty config as health check)
      configHealth: {
        schemaFields: Object.keys(configValidator.schema.properties || {}),
      },

      // Recent security events
      recentAuditEvents: auditLogger.query({ limit: 20 }),
      blockedActions: auditLogger.query({ blocked: true, limit: 10 }),
    };

    return NextResponse.json({ data: status });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
