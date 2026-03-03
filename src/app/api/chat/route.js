import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

// 存储正在执行的任务状态
const runningTasks = new Map();

export async function POST(request) {
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }
  try {
    const { message } = await request.json();
    if (!message) {
      return NextResponse.json({ error: '请输入消息' }, { status: 400 });
    }
    const reply = await company.chatWithSecretary(message);

    // 如果秘书返回了 create_department action，自动触发创建部门流程
    if (reply.action?.type === 'create_department') {
      const taskId = `dept_${Date.now()}`;
      const { departmentName, mission } = reply.action;
      const deptName = departmentName || '新项目部';
      const deptMission = mission || message;

      runningTasks.set(taskId, { status: 'running', type: 'create_department', startedAt: Date.now() });

      // 异步执行部门创建（不阻塞响应）
      (async () => {
        try {
          // 第一步：让秘书规划团队
          const plan = await company.planDepartment(deptName, deptMission);
          console.log(`📋 部门规划完成: ${plan.departmentName}，${plan.members.length}人`);

          // 第二步：直接确认执行招聘
          const dept = await company.confirmPlan(plan.planId);
          console.log(`✅ 部门创建完成: ${dept.name}，${dept.agents.size}人就位`);

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

          // 追加一条秘书消息通知老板
          company.chatHistory.push({
            role: 'secretary',
            content: `🎉 「${dept.name}」部门已成功创建！共招聘了 ${dept.agents.size} 名员工：\n${dept.getMembers().map(a => `  • ${a.name} (${a.role})`).join('\n')}\n\n团队已就位，随时可以接受任务！`,
            action: { type: 'department_created', departmentId: dept.id, departmentName: dept.name },
            time: new Date(),
          });
          company.save();

          setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
        } catch (err) {
          console.error(`❌ 部门创建失败:`, err.message);
          runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

          company.chatHistory.push({
            role: 'secretary',
            content: `😥 创建部门时遇到了问题：${err.message}\n\n要不我们再试试？`,
            time: new Date(),
          });
          company.save();

          setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
        }
      })();

      reply.action.taskId = taskId;
      reply.action.taskStatus = 'running';
    }

    // 如果秘书返回了 need_new_department action，也自动触发创建部门+分配任务
    if (reply.action?.type === 'need_new_department') {
      const taskId = `dept_task_${Date.now()}`;
      const suggestedMission = reply.action.suggestedMission || message;

      runningTasks.set(taskId, { status: 'running', type: 'create_and_assign', startedAt: Date.now() });

      (async () => {
        try {
          // 第一步：创建部门
          const plan = await company.planDepartment('新项目部', suggestedMission);
          const dept = await company.confirmPlan(plan.planId);
          console.log(`✅ 自动创建部门: ${dept.name}，${dept.agents.size}人就位`);

          // 追加秘书消息
          company.chatHistory.push({
            role: 'secretary',
            content: `🎉 我已经自动创建了「${dept.name}」部门（${dept.agents.size}人），现在开始执行任务...`,
            action: { type: 'department_created', departmentId: dept.id },
            time: new Date(),
          });
          company.save();

          // 第二步：分配任务
          const summary = await company.assignTaskToDepartment(dept.id, suggestedMission);
          runningTasks.set(taskId, { status: 'completed', summary, completedAt: Date.now() });
          console.log(`✅ 任务执行完成: ${summary.successTasks}/${summary.totalTasks}`);

          setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
        } catch (err) {
          console.error(`❌ 创建部门并分配任务失败:`, err.message);
          runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

          company.chatHistory.push({
            role: 'secretary',
            content: `😥 自动创建部门并分配任务时遇到了问题：${err.message}\n\n建议您手动创建部门后再试。`,
            time: new Date(),
          });
          company.save();

          setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
        }
      })();

      reply.action.taskId = taskId;
      reply.action.taskStatus = 'running';
    }

    // 如果秘书返回了task_assigned action，自动触发后台任务执行
    if (reply.action?.type === 'task_assigned' && reply.action.departmentId) {
      const taskId = `task_${Date.now()}`;
      const { departmentId, taskDescription, taskTitle } = reply.action;
      const description = taskDescription || message; // fallback 到原始消息

      // 将任务标记为进行中
      runningTasks.set(taskId, { status: 'running', departmentId, startedAt: Date.now() });

      // 异步执行任务（不阻塞响应）
      company.assignTaskToDepartment(departmentId, description, taskTitle || null)
        .then(summary => {
          runningTasks.set(taskId, { status: 'completed', summary, completedAt: Date.now() });
          console.log(`✅ 任务 [${taskId}] 执行完成: ${summary.successTasks}/${summary.totalTasks} 成功`);
          // 30分钟后清理
          setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
        })
        .catch(err => {
          console.error(`❌ 任务 [${taskId}] 执行失败:`, err.message);
          runningTasks.set(taskId, { status: 'failed', error: err.message, failedAt: Date.now() });

          // 追加秘书消息通知老板任务失败
          company.chatHistory.push({
            role: 'secretary',
            content: `❌ 任务执行失败了……错误信息：${err.message}\n\n要不再试一次？`,
            time: new Date(),
          });
          company.save();

          setTimeout(() => runningTasks.delete(taskId), 30 * 60 * 1000);
        });

      // 在reply中附加任务ID，前端可以用来轮询状态
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
  const company = getCompany();
  if (!company) {
    return NextResponse.json({ error: '请先创建公司' }, { status: 400 });
  }

  // 支持查询任务状态
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
