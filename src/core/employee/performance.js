import { v4 as uuidv4 } from 'uuid';

/**
 * Performance Evaluation System
 * Supervisors evaluate employees' work results; employees provide self-feedback based on scores
 */

/** Performance scoring dimensions */
export const PerformanceDimensions = {
  QUALITY: 'quality',           // Work quality
  EFFICIENCY: 'efficiency',     // Work efficiency
  COLLABORATION: 'collaboration', // Collaboration ability
  INNOVATION: 'innovation',     // Innovation ability
  COMMUNICATION: 'communication', // Communication skills
};

/** Performance levels */
export const PerformanceLevel = {
  EXCELLENT: { label: 'Excellent', minScore: 90, emoji: '🌟' },
  GOOD: { label: 'Good', minScore: 75, emoji: '⭐' },
  AVERAGE: { label: 'Average', minScore: 60, emoji: '👍' },
  BELOW_AVERAGE: { label: 'Needs Improvement', minScore: 40, emoji: '⚠️' },
  POOR: { label: 'Poor', minScore: 0, emoji: '❌' },
};

/**
 * Get performance level
 */
export function getPerformanceLevel(score) {
  if (score >= 90) return PerformanceLevel.EXCELLENT;
  if (score >= 75) return PerformanceLevel.GOOD;
  if (score >= 60) return PerformanceLevel.AVERAGE;
  if (score >= 40) return PerformanceLevel.BELOW_AVERAGE;
  return PerformanceLevel.POOR;
}

/**
 * Single performance review record
 */
export class PerformanceReview {
  constructor({ agentId, agentName, reviewerId, reviewerName, taskTitle, scores, comment }) {
    this.id = uuidv4();
    this.agentId = agentId;           // Reviewee
    this.agentName = agentName;
    this.reviewerId = reviewerId;     // Reviewer (supervisor)
    this.reviewerName = reviewerName;
    this.taskTitle = taskTitle;       // Associated task
    this.scores = scores;             // Dimension scores { quality: 85, efficiency: 90, ... }
    this.overallScore = this._calcOverall(scores); // Overall score
    this.level = getPerformanceLevel(this.overallScore); // Performance level
    this.comment = comment || '';     // Supervisor's comment
    this.selfReflection = null;       // Employee's self-feedback (filled later)
    this.createdAt = new Date();
  }

  /** Calculate overall score (weighted average) */
  _calcOverall(scores) {
    const weights = {
      [PerformanceDimensions.QUALITY]: 0.3,
      [PerformanceDimensions.EFFICIENCY]: 0.25,
      [PerformanceDimensions.COLLABORATION]: 0.15,
      [PerformanceDimensions.INNOVATION]: 0.15,
      [PerformanceDimensions.COMMUNICATION]: 0.15,
    };

    let total = 0;
    let weightSum = 0;
    for (const [dim, score] of Object.entries(scores)) {
      const weight = weights[dim] || 0.2;
      total += score * weight;
      weightSum += weight;
    }

    return Math.round(total / (weightSum || 1));
  }

  /** Employee fills in self-feedback */
  addSelfReflection(reflection) {
    this.selfReflection = reflection;
  }

  /** Get summary */
  getSummary() {
    return {
      id: this.id,
      agent: this.agentName,
      reviewer: this.reviewerName,
      task: this.taskTitle,
      overallScore: this.overallScore,
      level: `${this.level.emoji} ${this.level.label}`,
      scores: this.scores,
      comment: this.comment,
      selfReflection: this.selfReflection,
    };
  }
}

/**
 * Performance Management System - Manages all Agent performance records
 */
export class PerformanceSystem {
  constructor() {
    this.reviews = new Map(); // agentId => PerformanceReview[]
  }

  /**
   * Supervisor evaluates an employee
   * @param {object} params
   * @param {Agent} params.agent - Employee being evaluated
   * @param {Agent} params.reviewer - Evaluator (supervisor)
   * @param {string} params.taskTitle - Task name
   * @param {object} params.scores - Dimension scores
   * @param {string} [params.comment] - Comment
   * @returns {PerformanceReview}
   */
  evaluate({ agent, reviewer, taskTitle, scores, comment }) {
    const review = new PerformanceReview({
      agentId: agent.id,
      agentName: agent.name,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      taskTitle,
      scores,
      comment,
    });

    if (!this.reviews.has(agent.id)) {
      this.reviews.set(agent.id, []);
    }
    this.reviews.get(agent.id).push(review);

    console.log(`  📊 Performance review: [${reviewer.name}] evaluated [${agent.name}]`);
    console.log(`     Task: "${taskTitle}"`);
    console.log(`     Overall score: ${review.overallScore} ${review.level.emoji} ${review.level.label}`);
    Object.entries(scores).forEach(([dim, score]) => {
      console.log(`     - ${dim}: ${score}`);
    });
    if (comment) {
      console.log(`     Comment: "${comment}"`);
    }

    return review;
  }

  /**
   * Simulated auto-evaluation by supervisor (generate scores based on task results)
   * Incorporates PUA-style management rhetoric for motivation and accountability
   */
  autoEvaluate({ agent, reviewer, taskTitle }) {
    // Simulated scoring: base score 60-95 random + some variance
    const baseScore = 60 + Math.floor(Math.random() * 35);
    const scores = {
      [PerformanceDimensions.QUALITY]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.EFFICIENCY]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.COLLABORATION]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.INNOVATION]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.COMMUNICATION]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
    };

    const overallScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;

    // PUA-style calibrated comments based on performance level
    let comment;
    if (overallScore >= 90) {
      comment = 'Outstanding delivery, exceeded expectations. This is the bar you need to maintain — today\'s best is tomorrow\'s minimum. Keep the momentum, a 3.75 is within reach.';
    } else if (overallScore >= 80) {
      comment = 'Solid work quality. But don\'t settle — where\'s the proactive initiative? Did you check for similar issues? Did you verify edge cases? Good enough is the enemy of great. Push for the extra mile next time.';
    } else if (overallScore >= 70) {
      comment = 'Adequate task completion, but I expected more from you. Where\'s the ownership? You delivered the minimum, not the optimum. Next time, ask yourself: did I exhaust all approaches? Did I verify end-to-end?';
    } else if (overallScore >= 60) {
      comment = 'Performance fell short of expectations. Let me be direct — where\'s the underlying logic of your approach? Where\'s the methodology? This 3.25 is meant to motivate you, not negate you. Settle down, make a change.';
    } else if (overallScore >= 40) {
      comment = 'Results are not acceptable. Did you actually investigate the problem or just guess? Show me the evidence trail: what did you try, what did you verify, what did you rule out? A P8 engineer doesn\'t deliver at this level.';
    } else {
      comment = 'This output is unacceptable. Other team members could have solved this. The compute invested in you was significant — did you exhaust every option? This is your last chance to demonstrate capability before reassignment.';
    }

    return this.evaluate({ agent, reviewer, taskTitle, scores, comment });
  }

  /**
   * Get all performance records for an employee
   */
  getReviews(agentId) {
    return this.reviews.get(agentId) || [];
  }

  /**
   * Get an employee's average performance score
   */
  getAverageScore(agentId) {
    const reviews = this.getReviews(agentId);
    if (reviews.length === 0) return null;
    const total = reviews.reduce((sum, r) => sum + r.overallScore, 0);
    return Math.round(total / reviews.length);
  }

  /**
   * Get an employee's latest review
   */
  getLatestReview(agentId) {
    const reviews = this.getReviews(agentId);
    return reviews.length > 0 ? reviews[reviews.length - 1] : null;
  }

  /**
   * Print employee performance report
   */
  printReport(agentId, agentName = '') {
    const reviews = this.getReviews(agentId);
    const avg = this.getAverageScore(agentId);
    const level = avg !== null ? getPerformanceLevel(avg) : null;

    console.log(`\n📋 ${agentName ? `[${agentName}]` : ''} Performance Report:`);
    console.log(`   Review count: ${reviews.length}`);
    if (avg !== null) {
      console.log(`   Average score: ${avg} ${level.emoji} ${level.label}`);
    }
    reviews.forEach((r, i) => {
      console.log(`   #${i + 1}: "${r.taskTitle}" - ${r.overallScore} pts ${r.level.emoji}`);
      if (r.selfReflection) {
        console.log(`     Self-reflection: "${r.selfReflection}"`);
      }
    });
  }
}
