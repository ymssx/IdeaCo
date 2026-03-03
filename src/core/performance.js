import { v4 as uuidv4 } from 'uuid';

/**
 * 绩效评估系统
 * 由员工的上级进行工作结果评估打分，员工根据分数进行自我反馈
 */

/** 绩效评分维度 */
export const PerformanceDimensions = {
  QUALITY: 'quality',           // 工作质量
  EFFICIENCY: 'efficiency',     // 工作效率
  COLLABORATION: 'collaboration', // 协作能力
  INNOVATION: 'innovation',     // 创新能力
  COMMUNICATION: 'communication', // 沟通表达
};

/** 绩效等级 */
export const PerformanceLevel = {
  EXCELLENT: { label: '卓越', minScore: 90, emoji: '🌟' },
  GOOD: { label: '优秀', minScore: 75, emoji: '⭐' },
  AVERAGE: { label: '合格', minScore: 60, emoji: '👍' },
  BELOW_AVERAGE: { label: '待改进', minScore: 40, emoji: '⚠️' },
  POOR: { label: '不合格', minScore: 0, emoji: '❌' },
};

/**
 * 获取绩效等级
 */
export function getPerformanceLevel(score) {
  if (score >= 90) return PerformanceLevel.EXCELLENT;
  if (score >= 75) return PerformanceLevel.GOOD;
  if (score >= 60) return PerformanceLevel.AVERAGE;
  if (score >= 40) return PerformanceLevel.BELOW_AVERAGE;
  return PerformanceLevel.POOR;
}

/**
 * 单次绩效评估记录
 */
export class PerformanceReview {
  constructor({ agentId, agentName, reviewerId, reviewerName, taskTitle, scores, comment }) {
    this.id = uuidv4();
    this.agentId = agentId;           // 被评估人
    this.agentName = agentName;
    this.reviewerId = reviewerId;     // 评估人（上级）
    this.reviewerName = reviewerName;
    this.taskTitle = taskTitle;       // 对应的任务
    this.scores = scores;             // 各维度分数 { quality: 85, efficiency: 90, ... }
    this.overallScore = this._calcOverall(scores); // 综合分数
    this.level = getPerformanceLevel(this.overallScore); // 绩效等级
    this.comment = comment || '';     // 上级评语
    this.selfReflection = null;       // 员工自我反馈（稍后由员工填写）
    this.createdAt = new Date();
  }

  /** 计算综合分数（加权平均） */
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

  /** 员工填写自我反馈 */
  addSelfReflection(reflection) {
    this.selfReflection = reflection;
  }

  /** 获取摘要 */
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
 * 绩效管理系统 - 管理所有Agent的绩效记录
 */
export class PerformanceSystem {
  constructor() {
    this.reviews = new Map(); // agentId => PerformanceReview[]
  }

  /**
   * 上级对员工进行绩效评估
   * @param {object} params
   * @param {Agent} params.agent - 被评估的员工
   * @param {Agent} params.reviewer - 评估人（上级）
   * @param {string} params.taskTitle - 任务名称
   * @param {object} params.scores - 各维度分数
   * @param {string} [params.comment] - 评语
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

    console.log(`  📊 绩效评估: [${reviewer.name}] 评价 [${agent.name}]`);
    console.log(`     任务: "${taskTitle}"`);
    console.log(`     综合分数: ${review.overallScore} ${review.level.emoji} ${review.level.label}`);
    Object.entries(scores).forEach(([dim, score]) => {
      console.log(`     - ${dim}: ${score}`);
    });
    if (comment) {
      console.log(`     评语: "${comment}"`);
    }

    return review;
  }

  /**
   * 模拟上级自动评估（根据任务结果生成分数）
   */
  autoEvaluate({ agent, reviewer, taskTitle }) {
    // 模拟评分：基础分60-95随机 + 一些波动
    const baseScore = 60 + Math.floor(Math.random() * 35);
    const scores = {
      [PerformanceDimensions.QUALITY]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.EFFICIENCY]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.COLLABORATION]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.INNOVATION]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
      [PerformanceDimensions.COMMUNICATION]: Math.min(100, baseScore + Math.floor(Math.random() * 10 - 5)),
    };

    const comments = {
      90: '表现卓越，超出期望，是团队的标杆！',
      75: '工作表现优秀，完成质量高，继续保持。',
      60: '任务完成合格，但还有提升空间。',
      40: '表现不够理想，需要加强改进。',
      0: '工作成果未达标，需要严肃对待。',
    };

    const overallScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
    let comment = comments[0];
    for (const [threshold, c] of Object.entries(comments).sort((a, b) => b[0] - a[0])) {
      if (overallScore >= Number(threshold)) {
        comment = c;
        break;
      }
    }

    return this.evaluate({ agent, reviewer, taskTitle, scores, comment });
  }

  /**
   * 获取员工的所有绩效记录
   */
  getReviews(agentId) {
    return this.reviews.get(agentId) || [];
  }

  /**
   * 获取员工的平均绩效分数
   */
  getAverageScore(agentId) {
    const reviews = this.getReviews(agentId);
    if (reviews.length === 0) return null;
    const total = reviews.reduce((sum, r) => sum + r.overallScore, 0);
    return Math.round(total / reviews.length);
  }

  /**
   * 获取员工最新一次绩效
   */
  getLatestReview(agentId) {
    const reviews = this.getReviews(agentId);
    return reviews.length > 0 ? reviews[reviews.length - 1] : null;
  }

  /**
   * 打印员工绩效报告
   */
  printReport(agentId, agentName = '') {
    const reviews = this.getReviews(agentId);
    const avg = this.getAverageScore(agentId);
    const level = avg !== null ? getPerformanceLevel(avg) : null;

    console.log(`\n📋 ${agentName ? `[${agentName}]` : ''} 绩效报告:`);
    console.log(`   评估次数: ${reviews.length}`);
    if (avg !== null) {
      console.log(`   平均分数: ${avg} ${level.emoji} ${level.label}`);
    }
    reviews.forEach((r, i) => {
      console.log(`   第${i + 1}次: "${r.taskTitle}" - ${r.overallScore}分 ${r.level.emoji}`);
      if (r.selfReflection) {
        console.log(`     自我反馈: "${r.selfReflection}"`);
      }
    });
  }
}
