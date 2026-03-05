import { NextResponse } from 'next/server';
import { getCompany } from '@/lib/store';
import { getApiT } from '@/lib/api-i18n';

/**
 * GET /api/mailbox - Get mailbox list
 * POST /api/mailbox - Reply to mail
 */
export async function GET(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.companyNotFound') }, { status: 400 });

  return NextResponse.json({
    data: {
      mails: company.mailbox.slice().reverse().slice(0, 50),
      unreadCount: company.mailbox.filter(m => !m.read).length,
    },
  });
}

export async function POST(request) {
  const t = getApiT(request);
  const company = getCompany();
  if (!company) return NextResponse.json({ error: t('api.companyNotFound') }, { status: 400 });

  try {
    const { action, mailId, content } = await request.json();

    if (action === 'read') {
      // Mark as read
      const mail = company.mailbox.find(m => m.id === mailId);
      if (mail) mail.read = true;
      return NextResponse.json({ success: true });
    }

    if (action === 'reply') {
      // Boss replies to mail
      const mail = company.mailbox.find(m => m.id === mailId);
      if (!mail) return NextResponse.json({ error: t('api.mailNotFound') }, { status: 404 });

      mail.replied = true;
      mail.replies.push({
        from: 'boss',
        content,
        time: new Date(),
      });

      // Find the corresponding Agent to handle the boss's reply
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
        // Agent handles boss reply, generates reaction
        try {
          const reaction = await targetAgent.handleMessage({
            from: 'boss',
            type: 'feedback',
            content: `The boss replied to your mail "${mail.subject}":\n\n${content}`,
          });
          agentReply = reaction;
          // Agent also sends a reply
          mail.replies.push({
            from: mail.from.name,
            content: reaction,
            time: new Date(),
          });
        } catch (e) {
          agentReply = `Received the boss's reply, deeply grateful (although I don't have tear ducts)`;
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

    return NextResponse.json({ error: t('api.unknownOperation') }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
