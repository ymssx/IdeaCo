import { chatStore } from '@/core/agent/chat-store.js';

// Store running task states (shared across both streaming and non-streaming routes)
const runningTasks = new Map();

export { runningTasks };

/**
 * Process secretary action after LLM reply.
 * Handles: create_department, need_new_department, secretary_handle, task_assigned
 * This is shared by both the streaming and non-streaming chat routes.
 *
 * @param {object} reply - Parsed secretary reply { content, action }
 * @param {string} message - Original boss message
 * @param {object} company - Company instance
 */
export function processSecretaryAction(reply, message, company, { lang } = {}) {
  if (!reply.action) return;

  if (reply.action.type === 'create_department') {
    const taskId = `dept_${Date.now()}`;
    const { departmentName, mission, members } = reply.action;
    const deptName = departmentName || 'New Project Dept';
    const deptMission = mission || message;

    runningTasks.set(taskId, { status: 'running', type: 'create_department', startedAt: Date.now() });

    (async () => {
      try {
        const dept = await company.createDepartmentDirect({
          departmentName: deptName,
          mission: deptMission,
          members: members || [],
        });
        console.log(`✅ Department created: ${dept.name}, ${dept.agents.size} people ready`);

        runningTasks.set(taskId, {
          status: 'completed',
          summary: {
            departmentId: dept.id,
            departmentName: dept.name,
            memberCount: dept.agents.size,
            members: dept.getMembers().map(a => ({ name: a.name, role: a.role })),
          },
          completedAt: Date.now(),
        });

        const originalCreateMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'create_department');
        if (originalCreateMsg) {
          originalCreateMsg.action.taskStatus = 'completed';
          originalCreateMsg.action.departmentId = dept.id;
        }

        const notifyMsg = {
          role: 'secretary',
          content: `🎉 "${dept.name}" department has been created! Recruited ${dept.agents.size} employees:\n${dept.getMembers().map(a => `  • ${a.name} (${a.role})`).join('\n')}\n\nTeam is ready, awaiting tasks!`,
          action: { type: 'department_created', departmentId: dept.id, departmentName: dept.name },
          time: new Date(),
        };
        company.chatHistory.push(notifyMsg);
        chatStore.appendMessage(company.chatSessionId, notifyMsg);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      } catch (err) {
        console.error(`❌ Department creation failed:`, err.message);
        runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

        const originalCreateFail = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'create_department');
        if (originalCreateFail) {
          originalCreateFail.action.taskStatus = 'failed';
        }

        const errMsg1 = {
          role: 'secretary',
          content: `😥 Encountered a problem creating the department: ${err.message}\n\nShall we try again?`,
          time: new Date(),
        };
        company.chatHistory.push(errMsg1);
        chatStore.appendMessage(company.chatSessionId, errMsg1);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      }
    })();

    reply.action.taskId = taskId;
    reply.action.taskStatus = 'running';
  }

  if (reply.action?.type === 'need_new_department') {
    const taskId = `dept_task_${Date.now()}`;
    const suggestedMission = reply.action.suggestedMission || message;

    runningTasks.set(taskId, { status: 'running', type: 'create_and_assign', startedAt: Date.now() });

    (async () => {
      try {
        const dept = await company.createDepartmentDirect({
          departmentName: 'New Project Dept',
          mission: suggestedMission,
          members: [],
        });
        console.log(`✅ Auto-created department: ${dept.name}, ${dept.agents.size} people ready`);

        const autoCreateMsg = {
          role: 'secretary',
          content: `🎉 I've auto-created the "${dept.name}" department (${dept.agents.size} people), now starting task execution...`,
          action: { type: 'department_created', departmentId: dept.id },
          time: new Date(),
        };
        company.chatHistory.push(autoCreateMsg);
        chatStore.appendMessage(company.chatSessionId, autoCreateMsg);
        company.save();

        const summary = await company.assignTaskToDepartment(dept.id, suggestedMission);
        runningTasks.set(taskId, { status: 'completed', summary, completedAt: Date.now() });
        console.log(`✅ Task execution complete: ${summary.successTasks}/${summary.totalTasks}`);

        const originalNeedMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'need_new_department');
        if (originalNeedMsg) {
          originalNeedMsg.action.taskStatus = 'completed';
          originalNeedMsg.action.requirementId = summary.requirementId;
          originalNeedMsg.action.departmentId = dept.id;
        }

        const completionMsg = {
          role: 'secretary',
          content: `✅ Task "${summary.title || 'Task'}" completed! ${summary.successTasks}/${summary.totalTasks} subtasks succeeded.`,
          action: { type: 'task_completed', taskId, requirementId: summary.requirementId, departmentId: dept.id },
          time: new Date(),
        };
        company.chatHistory.push(completionMsg);
        chatStore.appendMessage(company.chatSessionId, completionMsg);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      } catch (err) {
        console.error(`❌ Create department and assign task failed:`, err.message);
        runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

        const originalNeedFail = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'need_new_department');
        if (originalNeedFail) {
          originalNeedFail.action.taskStatus = 'failed';
        }

        const errMsg2 = {
          role: 'secretary',
          content: `😥 Encountered a problem creating the department and assigning the task: ${err.message}\n\nPlease try creating the department manually and try again.`,
          time: new Date(),
        };
        company.chatHistory.push(errMsg2);
        chatStore.appendMessage(company.chatSessionId, errMsg2);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      }
    })();

    reply.action.taskId = taskId;
    reply.action.taskStatus = 'running';
  }

  if (reply.action?.type === 'secretary_handle') {
    const taskId = `secretary_${Date.now()}`;
    const { taskDescription } = reply.action;

    runningTasks.set(taskId, { status: 'running', type: 'secretary_handle', startedAt: Date.now() });

    (async () => {
      try {
        const result = await company.secretary.executeTaskDirectly(taskDescription || message, company, { lang });

        runningTasks.set(taskId, {
          status: 'completed',
          summary: { content: result.content, success: result.success },
          completedAt: Date.now(),
        });

        const resultMsg = {
          role: 'secretary',
          content: result.content,
          action: { type: 'secretary_task_completed', taskId },
          time: new Date(),
        };
        company.chatHistory.push(resultMsg);
        chatStore.appendMessage(company.chatSessionId, resultMsg);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      } catch (err) {
        console.error(`❌ Secretary task failed:`, err.message);
        runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

        const errMsg = {
          role: 'secretary',
          content: `😥 Encountered a problem while handling the task: ${err.message}\n\nWant me to try again?`,
          time: new Date(),
        };
        company.chatHistory.push(errMsg);
        chatStore.appendMessage(company.chatSessionId, errMsg);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      }
    })();

    reply.action.taskId = taskId;
    reply.action.taskStatus = 'running';
  }

  if (reply.action?.type === 'task_assigned' && reply.action.departmentId) {
    const taskId = `task_${Date.now()}`;
    const { departmentId, taskDescription, taskTitle } = reply.action;
    const description = taskDescription || message;

    runningTasks.set(taskId, { status: 'running', departmentId, startedAt: Date.now() });

    company.assignTaskToDepartment(departmentId, description, taskTitle || null)
      .then(summary => {
        runningTasks.set(taskId, { status: 'completed', summary, completedAt: Date.now() });
        console.log(`✅ Task [${taskId}] completed: ${summary.successTasks}/${summary.totalTasks} succeeded`);

        const originalMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'task_assigned');
        if (originalMsg) {
          originalMsg.action.taskStatus = 'completed';
          originalMsg.action.requirementId = summary.requirementId;
          originalMsg.action.departmentId = departmentId;
        }

        const completionMsg = {
          role: 'secretary',
          content: `✅ Task "${summary.title || taskTitle || 'Task'}" completed! ${summary.successTasks}/${summary.totalTasks} subtasks succeeded.`,
          action: { type: 'task_completed', taskId, requirementId: summary.requirementId, departmentId },
          time: new Date(),
        };
        company.chatHistory.push(completionMsg);
        chatStore.appendMessage(company.chatSessionId, completionMsg);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      })
      .catch(err => {
        console.error(`❌ Task [${taskId}] failed:`, err.message);
        runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

        const originalMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'task_assigned');
        if (originalMsg) {
          originalMsg.action.taskStatus = 'failed';
        }

        const taskFailMsg = {
          role: 'secretary',
          content: `❌ Task execution failed... Error: ${err.message}\n\nShall we try again?`,
          time: new Date(),
        };
        company.chatHistory.push(taskFailMsg);
        chatStore.appendMessage(company.chatSessionId, taskFailMsg);
        company.save();

        setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
      });

    reply.action.taskId = taskId;
    reply.action.taskStatus = 'running';
  }
}
