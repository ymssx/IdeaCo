import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { chatStore } from '@/core/agent/chat-store.js';
import { getApiT, getLanguageFromRequest } from '@/lib/api-i18n';
import { setAppLanguage } from '@/core/utils/app-language.js';

// Store running task states
const runningTasks = new Map();

export async function POST(request) {
  const t = getApiT(request);
  setAppLanguage(getLanguageFromRequest(request));
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }
  try {
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: t('api.messageRequired') }, { status: 400 });
    }
    const reply = await company.chatWithSecretary(message);

    // If secretary returned a create_department action, auto-trigger department creation flow
    if (reply.action?.type === 'create_department') {
      const taskId = `dept_${Date.now()}`;
      const { departmentName, mission, members } = reply.action;
      const deptName = departmentName || 'New Project Dept';
      const deptMission = mission || message;

      runningTasks.set(taskId, { status: 'running', type: 'create_department', startedAt: Date.now() });

      // Async department creation (non-blocking response)
      (async () => {
        try {
          // Secretary already designed the team — create department directly
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

          // Update the original create_department message status
          const originalCreateMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'create_department');
          if (originalCreateMsg) {
            originalCreateMsg.action.taskStatus = 'completed';
            originalCreateMsg.action.departmentId = dept.id;
          }

          // Append a secretary message to notify the boss
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

          // Update the original create_department message status
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

    // If secretary returned need_new_department action, also auto-trigger create department + assign task
    if (reply.action?.type === 'need_new_department') {
      const taskId = `dept_task_${Date.now()}`;
      const suggestedMission = reply.action.suggestedMission || message;

      runningTasks.set(taskId, { status: 'running', type: 'create_and_assign', startedAt: Date.now() });

      (async () => {
        try {
          // Step 1: Create department (will fallback to planDepartment since no members)
          const dept = await company.createDepartmentDirect({
            departmentName: 'New Project Dept',
            mission: suggestedMission,
            members: [],
          });
          console.log(`✅ Auto-created department: ${dept.name}, ${dept.agents.size} people ready`);

          // Append secretary message
          const autoCreateMsg = {
            role: 'secretary',
            content: `🎉 I've auto-created the "${dept.name}" department (${dept.agents.size} people), now starting task execution...`,
            action: { type: 'department_created', departmentId: dept.id },
            time: new Date(),
          };
          company.chatHistory.push(autoCreateMsg);
          chatStore.appendMessage(company.chatSessionId, autoCreateMsg);
          company.save();

          // Step 2: Assign task
          const summary = await company.assignTaskToDepartment(dept.id, suggestedMission);
          runningTasks.set(taskId, { status: 'completed', summary, completedAt: Date.now() });
          console.log(`✅ Task execution complete: ${summary.successTasks}/${summary.totalTasks}`);

          // Update the original need_new_department message status
          const originalNeedMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'need_new_department');
          if (originalNeedMsg) {
            originalNeedMsg.action.taskStatus = 'completed';
            originalNeedMsg.action.requirementId = summary.requirementId;
            originalNeedMsg.action.departmentId = dept.id;
          }

          // Push completion message to chat history
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

          // Update the original need_new_department message status
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

    // If secretary decided to handle the task herself
    if (reply.action?.type === 'secretary_handle') {
      const taskId = `secretary_${Date.now()}`;
      const { taskDescription } = reply.action;

      runningTasks.set(taskId, { status: 'running', type: 'secretary_handle', startedAt: Date.now() });

      // Async execution of secretary's own task
      (async () => {
        try {
          const result = await company.secretary.executeTaskDirectly(taskDescription || message, company);

          runningTasks.set(taskId, {
            status: 'completed',
            summary: { content: result.content, success: result.success },
            completedAt: Date.now(),
          });

          // Push the result as a secretary message
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

    // If secretary returned task_assigned action, auto-trigger background task execution
    if (reply.action?.type === 'task_assigned' && reply.action.departmentId) {
      const taskId = `task_${Date.now()}`;
      const { departmentId, taskDescription, taskTitle } = reply.action;
      const description = taskDescription || message; // fallback to original message

      // Mark task as in progress
      runningTasks.set(taskId, { status: 'running', departmentId, startedAt: Date.now() });

      // Async task execution (non-blocking response)
      company.assignTaskToDepartment(departmentId, description, taskTitle || null)
        .then(summary => {
          runningTasks.set(taskId, { status: 'completed', summary, completedAt: Date.now() });
          console.log(`✅ Task [${taskId}] completed: ${summary.successTasks}/${summary.totalTasks} succeeded`);

          // Update the original task_assigned message in chatHistory so the bubble reflects completion
          const originalMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'task_assigned');
          if (originalMsg) {
            originalMsg.action.taskStatus = 'completed';
            originalMsg.action.requirementId = summary.requirementId;
            originalMsg.action.departmentId = departmentId;
          }

          // Push completion message to chat history for frontend navigation
          const completionMsg = {
            role: 'secretary',
            content: `✅ Task "${summary.title || taskTitle || 'Task'}" completed! ${summary.successTasks}/${summary.totalTasks} subtasks succeeded.`,
            action: { type: 'task_completed', taskId, requirementId: summary.requirementId, departmentId },
            time: new Date(),
          };
          company.chatHistory.push(completionMsg);
          chatStore.appendMessage(company.chatSessionId, completionMsg);
          company.save();

          // Clean up after 30 minutes
          setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
        })
        .catch(err => {
          console.error(`❌ Task [${taskId}] failed:`, err.message);
          runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

          // Update the original task_assigned message to reflect failure
          const originalMsg = company.chatHistory.find(m => m.action?.taskId === taskId && m.action?.type === 'task_assigned');
          if (originalMsg) {
            originalMsg.action.taskStatus = 'failed';
          }

          // Append secretary message to notify boss of task failure
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

      // Attach task ID in reply for frontend polling
      reply.action.taskId = taskId;
      reply.action.taskStatus = 'running';
    }

    return NextResponse.json({
      success: true,
      data: {
        reply,
        chatHistory: company.chatHistory.slice(-30),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: t('api.noCompany') }, { status: 400 });
  }

  // Support task status queries
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');

  if (taskId) {
    const taskState = runningTasks.get(taskId);
    if (!taskState) {
      return NextResponse.json({ data: { status: 'unknown' } });
    }
    return NextResponse.json({ data: taskState });
  }

  return NextResponse.json({
    data: company.chatHistory.slice(-50),
  });
}
