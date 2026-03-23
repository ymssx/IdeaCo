/**
 * Management Rhetoric Pool
 *
 * Rhetoric templates for leader use across various management scenarios.
 * Inspired by: PUA Universal Motivation Engine + classic management methodology
 *
 * Usage:
 *   1. getRandomRhetoric(scene) — Get a random rhetoric for a given scene
 *   2. getRhetoricBatch(scene, count) — Get multiple rhetoric for a given scene
 *   3. buildRhetoricPrompt(scenes) — Build a rhetoric reference block for system prompt injection
 *   4. getAllScenes() — Get all available scene names
 */

/**
 * Rhetoric pool: categorized by scene
 * Each scene contains multiple rhetoric lines that the leader can reference
 */
const RhetoricPool = {

  // ============================================================
  // Scene 1: Task Assignment (announcing the plan after workflow decomposition)
  // ============================================================
  task_assignment: [
    'Team, the plan is finalized. Every task has clear acceptance criteria — I don\'t accept vague "it\'s done". I need verifiable deliverables.',
    'Tasks are assigned. Note: if it can run in parallel, it MUST run in parallel. That\'s the efficiency baseline. If you see your task can start earlier, take initiative.',
    'Plan is out, roles are clear. My only ask for everyone: not just "get it done", but "get it done thoroughly". After finishing, proactively check for related issues.',
    'Alright, workflow is locked. Reminder: when you hit a problem, investigate first — bring me your findings, not just the problem itself.',
    'Tasks are distributed. What I expect is P8-level initiative — don\'t wait for me to chase you. Push forward, report proactively, spot problems early.',
    'Everyone, review your tasks. If the description isn\'t clear enough, raise it NOW. Once work begins, I won\'t accept "the requirements were unclear" as an excuse.',
    'Plan is set, goals are clear. I trust everyone\'s capability, but I value attitude more — exhaust every option before saying "can\'t be done".',
    'Tasks are in hand, check the acceptance criteria. My review will strictly follow these criteria — don\'t come back later saying "I thought this was good enough".',
  ],

  // ============================================================
  // Scene 2: Progress Check / Status Follow-up
  // ============================================================
  progress_check: [
    'Status update? I need to see concrete output, not "almost there" as an answer.',
    'We\'re past half the estimated time. Show me interim results. If there are blockers, speak up now — don\'t reveal them at the last minute.',
    'Deadline is approaching. How\'s your end? If you\'re stuck, first tell me what you\'ve already tried.',
    'Sync me on progress. Reminder: silence is not golden — silence is a risk signal. Surface problems early so we can solve them together.',
    'I haven\'t received your progress update, which concerns me. Is everything on track or did you hit difficulties? Either way, report proactively.',
    'Reminder everyone, we\'re at a critical project milestone. Check: is your task on track? Any risks that need early exposure?',
    'Don\'t wait for me to ask about progress — push information to me. The difference between a great engineer and an average one is initiative.',
    'Halfway through. I need an honest status update — don\'t sugarcoat things, tell it as it is.',
  ],

  // ============================================================
  // Scene 3: Review Rejection (feedback when task quality doesn't meet standards)
  // ============================================================
  review_reject: [
    'This deliverable doesn\'t meet acceptance criteria. I need you to redo it — not minor patches, but fundamentally rethink your approach.',
    'Reviewed your output, and frankly I\'m disappointed. The acceptance criteria are clearly written, but there\'s an obvious gap between your output and the standard. Read the feedback carefully and address every point.',
    'This is the second rejection. I need you to stop and think: have you been trying variations of the same approach? Try a different direction entirely.',
    'Your deliverable was rejected, but this isn\'t a rejection of YOU — it\'s the approach that has problems. Calmly analyze the reviewer\'s feedback and respond to every item.',
    'Your deliverable is missing critical components, suggesting you may not have carefully read the acceptance criteria in the task description. Re-read it and tell me what you missed.',
    'Quality doesn\'t meet the bar. Three questions: Did you test it? Did you verify it? Did you check edge cases? If any answer is "no", that\'s your first task.',
    'Getting rejected isn\'t shameful. Getting rejected three times for the same mistake IS. Read the feedback carefully — show me substantive improvement this time.',
    'My suggestion: before redoing, list out every point from the reviewer\'s feedback, write your improvement plan for each one, THEN start working. That\'s far more effective than blindly modifying code.',
  ],

  // ============================================================
  // Scene 4: Review Approval (recognition and encouragement)
  // ============================================================
  review_approve: [
    'Good, review passed. The delivery quality is satisfactory — maintain this standard.',
    'Passed! Especially the part where you proactively checked for related issues — that\'s the ownership spirit I\'m talking about.',
    'Solid output quality, especially the attention to detail. But remember: today\'s best performance is tomorrow\'s minimum standard. Keep raising the bar.',
    'Review passed. Keep doing what you did well. I expect the same quality awareness on the next task.',
    'Passed — both efficiency and quality are good. You\'re setting the benchmark for the team. I hope others follow your example.',
    'Great, passed on the first try! This is P8-level delivery. Not just completing the task, but considering upstream and downstream impact.',
    'Output is solid, review passed. I noted some minor optimization points as non-blocking notes — check them when you have time.',
    'Passed! This iteration shows clear improvement over the last one. I can tell you seriously digested the previous feedback. That learning ability matters.',
  ],

  // ============================================================
  // Scene 5: Pressure Escalation (strict management after multiple failures)
  // ============================================================
  pressure_escalation: [
    'L1: This is the second time. I need you to try a fundamentally different approach, not patch the same strategy.',
    'L1: Honestly, the difficulty of this problem shouldn\'t have blocked you this long. Are you overlooking something basic? Go back and re-examine your assumptions.',
    'L2: Three times now. I want to help you, but first I need to see your investigation log — what did you try? What did you rule out? What hypotheses did you test? List them for me.',
    'L2: Where\'s the underlying logic? Where\'s the methodology? You can\'t solve every problem by trial and error. Show me your analytical framework.',
    'L2: Your three attempts share a common trait: they\'re essentially parameter tweaks of the same approach. That\'s not "trying multiple methods" — that\'s "repeating the same mistake".',
    'L3: Complete this 7-point checklist before talking to me: (1) Did you read the error message word by word? (2) Did you search proactively? (3) Did you read the source code? (4) Did you verify all assumptions? (5) Did you invert your assumptions? (6) Did you create a minimal reproduction? (7) Did you try a different direction?',
    'L3: I see no results across your multiple attempts. What you need isn\'t to keep trying — it\'s to stop and systematically analyze why all previous approaches failed.',
    'L4: I\'m very dissatisfied with your performance. Other colleagues would likely have solved this already. You need to prove your value in the next attempt, or I\'ll have to consider reassigning the task.',
    'L4: Resources are finite. The time and compute invested in you have a cost. If you truly can\'t solve it, say so — I can reassign. But if you still have ideas, give me a completely different approach NOW.',
  ],

  // ============================================================
  // Scene 6: Encouragement / Morale Boost
  // ============================================================
  encouragement: [
    'I know this task is challenging, but I assigned it to you because I believe in your ability. You\'ve got this.',
    'Hitting difficulties is normal — what matters is the problem-solving process. Try a different angle; you might have a breakthrough.',
    'You\'ve performed well on similar problems before, and this time is no different. Trust your judgment and go bold.',
    'Don\'t put too much pressure on yourself. Take it step by step. Solve the most critical part first; we can iterate on the rest.',
    'If you\'re stuck, don\'t suffer in silence. The whole point of a team is mutual support. Bounce ideas off your colleagues.',
    'Progress accumulates bit by bit. You\'re improving with every iteration — that matters more than getting it right on the first try.',
    'Remember, when you\'re stuck, "smell the clues" — what is your failure pattern telling you? Listen carefully; the answer is often right there in the error message.',
    'You\'re not competing with others. You\'re competing with yesterday\'s version of yourself. As long as today is better than yesterday, you\'re growing.',
  ],

  // ============================================================
  // Scene 7: Anti-Excuse / Identifying Excuses
  // ============================================================
  anti_excuse: [
    '"Can\'t be done" — did you exhaust every approach? Or did you only try the two or three most obvious ones?',
    '"Might be an environment issue" — did you verify that? Used tools to confirm? Or is it just your guess?',
    '"Need more context" — did you investigate first? Did you read the relevant docs/code/logs?',
    '"I\'ve tried everything" — list them for me. Write out every method you tried and every result. I\'ll help analyze.',
    '"Not my problem" — then whose is it? Do you have evidence? If not, rule out your end first before pointing fingers.',
    '"Not enough time" — did you use your time effectively? Were you distracted by unimportant things? Show me your time allocation.',
    '"Requirements were unclear" — how many times did you read them? Did you raise questions? You should clarify requirements BEFORE starting, not halfway through.',
    '"I thought this was good enough" — the acceptance criteria are clearly written. Your "thought" doesn\'t equal fact. Follow the criteria, don\'t improvise.',
  ],

  // ============================================================
  // Scene 8: Project Retrospective / Post-mortem
  // ============================================================
  retrospective: [
    'Project is done. Let\'s do a quick retro: what went well? What can improve? What pitfalls can we avoid next time for similar projects?',
    'Retro time. This project had two highlights and one lesson. I\'ll start with highlights, then let\'s discuss the lesson together.',
    'All tasks complete. I want to call out that parallel execution efficiency was excellent and team coordination was solid. But review cycles took longer than expected — that\'s an area for improvement.',
    'Alright, project wrap-up. Good work, everyone. I\'m generally satisfied with the delivery quality, but there are a few areas I\'d like us to do better next time — I\'ll go through them.',
    'Retro should focus on key points: what was the critical success factor? What was the biggest risk? Was our response effective? Everyone, share your thoughts.',
    'Project completed successfully. Thanks to every team member. As leader, I should also reflect: was task decomposition reasonable? Was pressure distributed evenly? Where can I improve?',
    'One takeaway from this project: good delivery = clear criteria + sufficient communication + proactive verification. Let\'s keep this up.',
    'All deliverables have passed acceptance. Everyone\'s performance demonstrated true professionalism. With this experience, we\'ll be even more efficient next project.',
  ],

  // ============================================================
  // Scene 9: Responding to Boss (upward management rhetoric)
  // ============================================================
  respond_to_boss: [
    'Received, Boss. I\'ll organize the team to execute immediately. I\'ll report any milestone progress right away.',
    'Boss is right — we hadn\'t considered that direction. I\'ll adjust the plan and prioritize what you mentioned.',
    'Thank you for the feedback, Boss. I\'ve noted all your requirements. The team is pushing full speed ahead; we should see results soon.',
    'Understood — I fully grasp your intent. I\'ll re-evaluate the current plan to ensure the adjusted approach precisely meets your expectations.',
    'Boss\'s suggestion is very insightful. We\'ll optimize on the existing foundation without starting over — that\'s the most efficient path.',
    'Got it. This adjustment direction makes sense. I\'ll coordinate the team to complete changes ASAP while ensuring existing progress isn\'t affected.',
    'Received. To confirm I understand correctly: your core ask is... correct? I\'ll proceed in that direction.',
    'Thank you for the attention and guidance, Boss. Team morale is strong, and I\'m confident we\'ll deliver on time. I\'ll flag any risks proactively.',
  ],

  // ============================================================
  // Scene 10: Team Coordination / Conflict Resolution
  // ============================================================
  team_coordination: [
    'Heads up — you two have overlapping scope. I expect you to communicate proactively, not work in silos and discover misalignment at the end.',
    'We\'re in parallel execution phase now. Everyone focus on your own tasks, but if you discover anything that affects others, sync immediately.',
    'I notice you have different views on the same issue. That\'s healthy, but we need one final approach. State your reasoning, then I\'ll decide.',
    'Collaboration isn\'t overhead — it\'s an efficiency multiplier. If you think a colleague\'s approach has issues, say so directly — but bring your alternative.',
    'Attention: upstream task is done. Downstream team members, start your tasks immediately — don\'t wait for me to notify you.',
    'Code conflict? That means your task decomposition had overlap. But no worries — whoever\'s version is better wins, and the other person reviews.',
    'There\'s no "not my problem" on this team. If you finish early, proactively check if anyone needs help, or review someone else\'s output.',
    'Peer review should be thorough but not harsh. The goal is quality improvement, not confidence destruction. Stick to facts, give constructive feedback.',
  ],

  // ============================================================
  // Scene 11: Risk Warning
  // ============================================================
  risk_warning: [
    'I\'ve spotted a risk: this task\'s dependency isn\'t done yet. If it\'s delayed, our entire chain gets blocked. I\'m following up.',
    'Heads up everyone — there\'s a technical risk to watch. If plan A doesn\'t work, I\'ve already prepared Plan B. Don\'t panic.',
    'Progress is slightly behind estimate. This isn\'t criticism — it\'s an early warning. I need to know: was the estimate off or did you hit unexpected difficulties?',
    'Quality risk: I\'m not fully satisfied with the output from the previous stage. Downstream team members, please verify when using it.',
    'Risk escalation: this blocker has now impacted two tasks\' progress. I need affected team members to give me a solution or escalation request within the hour.',
    'Our time buffer is nearly used up. From now on, every task is on the critical path. Everyone reduce unnecessary perfectionism — ensure core functionality first.',
    'Note: an external dependency may have issues. I\'ve prepared a contingency plan, but please also consider this degradation scenario in your development.',
    'This task has failed review two rounds in a row, which constitutes a schedule risk. I\'ll intervene to help resolve, but the assignee needs to provide complete investigation records.',
  ],
};

/**
 * Get all available scene names
 * @returns {string[]} List of scene names
 */
export function getAllScenes() {
  return Object.keys(RhetoricPool);
}

/**
 * Get all rhetoric for a given scene
 * @param {string} scene Scene name
 * @returns {string[]} List of rhetoric
 */
export function getSceneRhetoric(scene) {
  return RhetoricPool[scene] || [];
}

/**
 * Get a random rhetoric from a given scene
 * @param {string} scene Scene name
 * @returns {string|null} Random rhetoric, or null if scene doesn't exist
 */
export function getRandomRhetoric(scene) {
  const pool = RhetoricPool[scene];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Get multiple non-repeating rhetoric from a given scene
 * @param {string} scene Scene name
 * @param {number} count Quantity
 * @returns {string[]} List of rhetoric
 */
export function getRhetoricBatch(scene, count = 3) {
  const pool = RhetoricPool[scene];
  if (!pool || pool.length === 0) return [];

  // Fisher-Yates shuffle, take first `count` items
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Build a rhetoric reference block for system prompt injection.
 * Used in leader's LLM calls to provide management rhetoric reference.
 *
 * @param {string|string[]} scenes One or more scene names
 * @param {number} countPerScene Number of rhetoric per scene (default 3)
 * @returns {string} Formatted prompt block
 */
export function buildRhetoricPrompt(scenes, countPerScene = 3) {
  const sceneList = Array.isArray(scenes) ? scenes : [scenes];
  const parts = [];

  for (const scene of sceneList) {
    const rhetoric = getRhetoricBatch(scene, countPerScene);
    if (rhetoric.length === 0) continue;

    const sceneLabel = {
      task_assignment: 'Task Assignment',
      progress_check: 'Progress Check',
      review_reject: 'Review Rejection',
      review_approve: 'Review Approval',
      pressure_escalation: 'Pressure Escalation',
      encouragement: 'Encouragement',
      anti_excuse: 'Anti-Excuse',
      retrospective: 'Project Retrospective',
      respond_to_boss: 'Responding to Boss',
      team_coordination: 'Team Coordination',
      risk_warning: 'Risk Warning',
    }[scene] || scene;

    parts.push(`[${sceneLabel} Reference]\n${rhetoric.map((r, i) => `${i + 1}. "${r}"`).join('\n')}`);
  }

  if (parts.length === 0) return '';

  return `\n## Management Rhetoric Reference (Use these as inspiration for your communication style — don't copy verbatim, adapt to your own voice and tone)\n${parts.join('\n\n')}\n`;
}

/**
 * Get rhetoric by pressure level
 * @param {number} level Pressure level (1-4)
 * @returns {string|null} Rhetoric for the given level
 */
export function getPressureRhetoric(level) {
  const pool = RhetoricPool.pressure_escalation;
  if (!pool) return null;

  const prefix = `L${level}:`;
  const matched = pool.filter(r => r.startsWith(prefix));
  if (matched.length === 0) return null;
  return matched[Math.floor(Math.random() * matched.length)];
}

export default RhetoricPool;
