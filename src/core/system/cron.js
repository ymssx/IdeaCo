/**
 * Cron Scheduler - Automated task scheduling system for agents
 *
 * Distilled from OpenClaw's cron system (vendor/openclaw/src/cron/)
 * Re-implemented as an enterprise "automated workflow / standing orders" system
 *
 * Features:
 * - Cron expression parsing (simplified subset)
 * - Job registration and lifecycle management
 * - Agent-bound scheduled tasks
 * - Execution history and failure tracking
 * - Graceful concurrent execution control
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * Job status enum
 */
export const JobStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  RUNNING: 'running',
  COMPLETED: 'completed', // For one-shot jobs
  ERROR: 'error',
};

/**
 * Simplified cron expression parser
 * Supports: "every Xm" (minutes), "every Xh" (hours), "daily HH:MM", "weekly DOW HH:MM"
 * Also supports standard 5-field cron: "* * * * *" (min hour dom month dow)
 */
export function parseCronExpression(expression) {
  const expr = expression.trim().toLowerCase();

  // "every Xm" - every X minutes
  const minuteMatch = expr.match(/^every\s+(\d+)\s*m(?:in(?:ute)?s?)?$/);
  if (minuteMatch) {
    return { type: 'interval', intervalMs: parseInt(minuteMatch[1]) * 60 * 1000 };
  }

  // "every Xh" - every X hours
  const hourMatch = expr.match(/^every\s+(\d+)\s*h(?:ours?)?$/);
  if (hourMatch) {
    return { type: 'interval', intervalMs: parseInt(hourMatch[1]) * 3600 * 1000 };
  }

  // "daily HH:MM" - daily at specific time
  const dailyMatch = expr.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    return {
      type: 'daily',
      hour: parseInt(dailyMatch[1]),
      minute: parseInt(dailyMatch[2]),
    };
  }

  // "weekly DOW HH:MM" - weekly on specific day and time
  const weeklyMatch = expr.match(/^weekly\s+(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2}):(\d{2})$/);
  if (weeklyMatch) {
    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    return {
      type: 'weekly',
      dayOfWeek: dayMap[weeklyMatch[1]],
      hour: parseInt(weeklyMatch[2]),
      minute: parseInt(weeklyMatch[3]),
    };
  }

  throw new Error(`Invalid cron expression: "${expression}". Supported formats: "every Xm", "every Xh", "daily HH:MM", "weekly DOW HH:MM"`);
}

/**
 * Calculate next run time for a parsed cron schedule
 * @param {object} schedule - Parsed cron schedule
 * @param {Date} after - Calculate next run after this time
 * @returns {Date}
 */
export function getNextRunTime(schedule, after = new Date()) {
  if (schedule.type === 'interval') {
    return new Date(after.getTime() + schedule.intervalMs);
  }

  if (schedule.type === 'daily') {
    const next = new Date(after);
    next.setHours(schedule.hour, schedule.minute, 0, 0);
    if (next <= after) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (schedule.type === 'weekly') {
    const next = new Date(after);
    next.setHours(schedule.hour, schedule.minute, 0, 0);
    const currentDay = next.getDay();
    let daysUntil = schedule.dayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next <= after)) {
      daysUntil += 7;
    }
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  throw new Error('Unknown schedule type');
}

/**
 * Scheduled Job definition
 */
class CronJob {
  /**
   * @param {object} config
   * @param {string} config.id - Unique job ID
   * @param {string} config.name - Human-readable job name
   * @param {string} config.description - What this job does
   * @param {string} config.cronExpression - Schedule expression
   * @param {string} config.agentId - Agent to execute this job
   * @param {string} config.taskPrompt - The prompt/instruction for the agent
   * @param {boolean} config.oneShot - If true, run once then mark completed
   * @param {number} config.maxConsecutiveFailures - Stop after N consecutive failures
   */
  constructor(config) {
    this.id = config.id || uuidv4();
    this.name = config.name;
    this.description = config.description || '';
    this.cronExpression = config.cronExpression;
    this.schedule = parseCronExpression(config.cronExpression);
    this.agentId = config.agentId;
    this.taskPrompt = config.taskPrompt;
    this.oneShot = config.oneShot || false;
    this.maxConsecutiveFailures = config.maxConsecutiveFailures ?? 3;

    this.status = JobStatus.ACTIVE;
    this.nextRun = getNextRunTime(this.schedule);
    this.lastRun = null;
    this.lastResult = null;
    this.lastError = null;
    this.runCount = 0;
    this.failCount = 0;
    this.consecutiveFailures = 0;
    this.createdAt = new Date();

    // History of recent executions
    this.history = [];
    this.maxHistory = 20;
  }
}

/**
 * Cron Scheduler - Manages and executes scheduled jobs
 */
export class CronScheduler {
  /**
   * @param {object} options
   * @param {number} options.tickInterval - How often to check for jobs to run (ms)
   * @param {Function} options.executor - async (agentId, taskPrompt, jobId) => result
   * @param {Function} options.onJobRun - Callback when a job starts running
   * @param {Function} options.onJobComplete - Callback when a job completes
   * @param {Function} options.onJobError - Callback when a job fails
   */
  constructor(options = {}) {
    this.tickInterval = options.tickInterval ?? 60000; // Check every minute
    this.executor = options.executor || null;
    this.onJobRun = options.onJobRun || null;
    this.onJobComplete = options.onJobComplete || null;
    this.onJobError = options.onJobError || null;

    this.jobs = new Map(); // id -> CronJob
    this.timer = null;
    this.running = false;
  }

  /**
   * Register a new scheduled job
   * @param {object} config - Job configuration
   * @returns {CronJob}
   */
  addJob(config) {
    const job = new CronJob(config);
    this.jobs.set(job.id, job);
    console.log(`⏰ Cron job registered: "${job.name}" [${job.cronExpression}]`);
    return job;
  }

  /**
   * Remove a job
   * @param {string} jobId
   */
  removeJob(jobId) {
    this.jobs.delete(jobId);
  }

  /**
   * Pause a job
   * @param {string} jobId
   */
  pauseJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) job.status = JobStatus.PAUSED;
  }

  /**
   * Resume a paused job
   * @param {string} jobId
   */
  resumeJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job && (job.status === JobStatus.PAUSED || job.status === JobStatus.ERROR)) {
      job.status = JobStatus.ACTIVE;
      job.consecutiveFailures = 0;
      job.nextRun = getNextRunTime(job.schedule);
    }
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.running) return;
    this.running = true;
    console.log(`⏰ Cron scheduler started (tick every ${this.tickInterval / 1000}s)`);
    this.timer = setInterval(() => this._tick(), this.tickInterval);
    // Run an immediate tick
    this._tick();
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('⏰ Cron scheduler stopped');
  }

  /**
   * Check for and execute due jobs
   */
  async _tick() {
    const now = new Date();

    for (const [jobId, job] of this.jobs) {
      // Skip non-active jobs
      if (job.status !== JobStatus.ACTIVE) continue;

      // Check if job is due
      if (job.nextRun && job.nextRun <= now) {
        await this._executeJob(job);
      }
    }
  }

  /**
   * Execute a single job
   * @param {CronJob} job
   */
  async _executeJob(job) {
    if (!this.executor) {
      console.warn(`[CronScheduler] No executor configured, skipping job: ${job.name}`);
      return;
    }

    job.status = JobStatus.RUNNING;
    job.lastRun = new Date();
    job.runCount++;

    // Notify: job starting
    if (this.onJobRun) {
      try { this.onJobRun(job); } catch {}
    }

    const historyEntry = {
      runAt: job.lastRun.toISOString(),
      success: false,
      result: null,
      error: null,
      duration: 0,
    };

    const startTime = Date.now();

    try {
      const result = await this.executor(job.agentId, job.taskPrompt, job.id);
      const duration = Date.now() - startTime;

      job.lastResult = result;
      job.lastError = null;
      job.consecutiveFailures = 0;

      historyEntry.success = true;
      historyEntry.result = typeof result === 'string' ? result.slice(0, 200) : 'OK';
      historyEntry.duration = duration;

      // Handle one-shot jobs
      if (job.oneShot) {
        job.status = JobStatus.COMPLETED;
      } else {
        job.status = JobStatus.ACTIVE;
        job.nextRun = getNextRunTime(job.schedule);
      }

      // Notify: job completed
      if (this.onJobComplete) {
        try { this.onJobComplete(job, result); } catch {}
      }

    } catch (error) {
      const duration = Date.now() - startTime;

      job.lastError = error.message;
      job.failCount++;
      job.consecutiveFailures++;

      historyEntry.error = error.message;
      historyEntry.duration = duration;

      // Check if we should stop the job
      if (job.consecutiveFailures >= job.maxConsecutiveFailures) {
        job.status = JobStatus.ERROR;
        console.error(`⏰ Cron job "${job.name}" stopped after ${job.consecutiveFailures} consecutive failures`);
      } else {
        job.status = JobStatus.ACTIVE;
        job.nextRun = getNextRunTime(job.schedule);
      }

      // Notify: job error
      if (this.onJobError) {
        try { this.onJobError(job, error); } catch {}
      }
    }

    // Add to history
    job.history.push(historyEntry);
    if (job.history.length > job.maxHistory) {
      job.history.shift();
    }
  }

  /**
   * Manually trigger a job (ignoring schedule)
   * @param {string} jobId
   * @returns {Promise}
   */
  async triggerJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    return this._executeJob(job);
  }

  /**
   * List all jobs with their status
   * @returns {Array}
   */
  listJobs() {
    return [...this.jobs.values()].map(job => ({
      id: job.id,
      name: job.name,
      description: job.description,
      cronExpression: job.cronExpression,
      agentId: job.agentId,
      status: job.status,
      nextRun: job.nextRun?.toISOString() || null,
      lastRun: job.lastRun?.toISOString() || null,
      lastError: job.lastError,
      runCount: job.runCount,
      failCount: job.failCount,
      consecutiveFailures: job.consecutiveFailures,
      historyLength: job.history.length,
    }));
  }

  /**
   * Get execution history for a specific job
   * @param {string} jobId
   * @returns {Array}
   */
  getJobHistory(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return [];
    return [...job.history].reverse();
  }

  /**
   * Get scheduler summary
   * @returns {object}
   */
  getSummary() {
    const jobs = [...this.jobs.values()];
    return {
      running: this.running,
      totalJobs: jobs.length,
      activeJobs: jobs.filter(j => j.status === JobStatus.ACTIVE).length,
      pausedJobs: jobs.filter(j => j.status === JobStatus.PAUSED).length,
      errorJobs: jobs.filter(j => j.status === JobStatus.ERROR).length,
      totalRuns: jobs.reduce((sum, j) => sum + j.runCount, 0),
      totalFailures: jobs.reduce((sum, j) => sum + j.failCount, 0),
    };
  }

  /**
   * Serialize scheduler state (for persistence)
   * @returns {object}
   */
  serialize() {
    const jobs = [];
    for (const [id, job] of this.jobs) {
      jobs.push({
        id: job.id,
        name: job.name,
        description: job.description,
        cronExpression: job.cronExpression,
        agentId: job.agentId,
        taskPrompt: job.taskPrompt,
        oneShot: job.oneShot,
        maxConsecutiveFailures: job.maxConsecutiveFailures,
        status: job.status,
        runCount: job.runCount,
        failCount: job.failCount,
        createdAt: job.createdAt.toISOString(),
      });
    }
    return { jobs };
  }

  /**
   * Restore scheduler state from serialized data
   * @param {object} data
   */
  restore(data) {
    if (!data || !data.jobs) return;
    for (const jobData of data.jobs) {
      try {
        const job = this.addJob(jobData);
        if (jobData.status === JobStatus.PAUSED) job.status = JobStatus.PAUSED;
        if (jobData.status === JobStatus.ERROR) job.status = JobStatus.ERROR;
        job.runCount = jobData.runCount || 0;
        job.failCount = jobData.failCount || 0;
      } catch (err) {
        console.error(`[CronScheduler] Failed to restore job "${jobData.name}":`, err.message);
      }
    }
  }
}

// Global singleton
export const cronScheduler = new CronScheduler();
