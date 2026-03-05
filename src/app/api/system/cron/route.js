import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { cronScheduler } from '@/core/cron.js';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/system/cron - List all cron jobs
 */
export async function GET() {
  try {
    return NextResponse.json({
      data: {
        summary: cronScheduler.getSummary(),
        jobs: cronScheduler.listJobs(),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/system/cron - Manage cron jobs
 * 
 * Actions:
 * - create: { name, cronExpression, agentId, taskPrompt, description? }
 * - pause: { jobId }
 * - resume: { jobId }
 * - trigger: { jobId }
 * - delete: { jobId }
 */
export async function POST(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { action = 'create' } = body;

    switch (action) {
      case 'create': {
        const { name, cronExpression, agentId, taskPrompt, description } = body;
        if (!name || !cronExpression || !agentId || !taskPrompt) {
          return NextResponse.json(
            { error: t('api.cronMissingFields') },
            { status: 400 }
          );
        }

        // Verify agent exists
        let agentFound = false;
        for (const dept of company.departments.values()) {
          if (dept.agents.has(agentId)) {
            agentFound = true;
            break;
          }
        }
        if (!agentFound) {
          return NextResponse.json({ error: t('api.agentNotFoundId', { id: agentId }) }, { status: 404 });
        }

        const job = cronScheduler.addJob({
          name,
          cronExpression,
          agentId,
          taskPrompt,
          description: description || '',
        });

        return NextResponse.json({
          data: {
            id: job.id,
            name: job.name,
            cronExpression: job.cronExpression,
            nextRun: job.nextRun?.toISOString(),
            status: job.status,
          },
        });
      }

      case 'pause': {
        cronScheduler.pauseJob(body.jobId);
        return NextResponse.json({ data: { success: true } });
      }

      case 'resume': {
        cronScheduler.resumeJob(body.jobId);
        return NextResponse.json({ data: { success: true } });
      }

      case 'trigger': {
        await cronScheduler.triggerJob(body.jobId);
        return NextResponse.json({ data: { success: true } });
      }

      case 'delete': {
        cronScheduler.removeJob(body.jobId);
        return NextResponse.json({ data: { success: true } });
      }

      default:
        return NextResponse.json({ error: t('api.pluginUnknownAction', { action }) }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
