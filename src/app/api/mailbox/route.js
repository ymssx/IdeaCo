import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';

/**
 * GET /api/mailbox - 获取邮箱列表
 * POST /api/mailbox - 回复邮件
 */
export async function GET() {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: '公司不存在' }, { status: 400 });

  return NextResponse.json({
    data: {
      mails: company.mailbox.slice().reverse().slice(0, 50),
      unreadCount: company.mailbox.filter(m => !m.read).length,
    },
  });
}

export async function POST(request) {
  const company = getCompany();
  if (!company) return NextResponse.json({ error: '公司不存在' }, { status: 400 });

  try {
    const { action, mailId, content } = await request.json();

    if (action === 'read') {
      // 标记已读
      const mail = company.mailbox.find(m => m.id === mailId);
      if (mail) mail.read = true;
      return NextResponse.json({ success: true });
    }

    if (action === 'reply') {
      // 老板回复邮件
      const mail = company.mailbox.find(m => m.id === mailId);
      if (!mail) return NextResponse.json({ error: '邮件不存在，可能已被404' }, { status: 404 });

      mail.replied = true;
      mail.replies.push({
        from: 'boss',
        content,
        time: new Date(),
      });

      // 找到对应的Agent，让它处理老板的回复
      let targetAgent = null;
      for (const dept of company.departments.values()) {
        const agent = dept.agents.get(mail.from.id);
        if (agent) {
          targetAgent = agent;
          break;
        }
      }

      let agentReply = null;
      if (targetAgent) {
        // Agent处理老板回复，生成反应
        try {
          const reaction = await targetAgent.handleMessage({
            from: 'boss',
            type: 'feedback',
            content: `老板回复了你的邮件「${mail.subject}」：\n\n${content}`,
          });
          agentReply = reaction;
          // Agent也回一封信
          mail.replies.push({
            from: mail.from.name,
            content: reaction,
            time: new Date(),
          });
        } catch (e) {
          agentReply = `收到老板回复，感激涕零（虽然我没有泪腺）`;
          mail.replies.push({
            from: mail.from.name,
            content: agentReply,
            time: new Date(),
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: { agentReply },
      });
    }

    if (action === 'readAll') {
      company.mailbox.forEach(m => m.read = true);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
