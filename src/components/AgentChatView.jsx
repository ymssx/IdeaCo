'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import { MessageBubble, ChatInput } from './ChatShared';
import CachedAvatar from './CachedAvatar';

// How many messages to load per page
const PAGE_SIZE = 30;
// How close to the bottom (px) to consider "at bottom"
const BOTTOM_THRESHOLD = 80;

/**
 * Virtualized agent 1-on-1 chat view.
 *
 * Features:
 * - Initial load: fetches last PAGE_SIZE messages, scrolls to bottom instantly
 * - Polling: checks for new messages every 2s via `after` cursor, appends without scrolling
 * - Scroll up: lazy-loads older messages, preserves scroll position
 * - "Jump to bottom" button when user scrolls away from bottom
 *
 * Props:
 *   - active: boolean — whether this view is currently visible/active (controls polling)
 *   - agentId: string — the agent to chat with
 *   - agentName: string
 *   - agentAvatar: string
 *   - agentRole: string
 *   - onClickAvatar: function(agentId) — callback when clicking agent avatar
 */
export default function AgentChatView({
  active = true,
  agentId,
  agentName,
  agentAvatar,
  agentRole,
  onClickAvatar,
}) {
  const {
    company, chatWithAgent,
    fetchAgentChatPage, pollAgentNewMessages,
  } = useStore();
  const { t } = useI18n();

  // === State ===
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMsgCount, setNewMsgCount] = useState(0);

  // === Refs ===
  const scrollContainerRef = useRef(null);
  const bottomRef = useRef(null);
  const latestTimeRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const activeRef = useRef(active);
  const agentIdRef = useRef(agentId);
  const pollTimerRef = useRef(null);
  const sendingRef = useRef(false); // pause polling while sending to avoid duplication

  const bossName = company?.boss;
  const bossAvatar = company?.bossAvatar;

  // Keep refs in sync
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { isAtBottomRef.current = isAtBottom; }, [isAtBottom]);
  useEffect(() => { agentIdRef.current = agentId; }, [agentId]);

  // === Scroll position tracking ===
  const checkIfAtBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior = 'instant') => {
    bottomRef.current?.scrollIntoView({ behavior });
    setIsAtBottom(true);
    setNewMsgCount(0);
  }, []);

  // === Initial load ===
  useEffect(() => {
    if (!active || !agentId) return;
    let cancelled = false;

    const load = async () => {
      const result = await fetchAgentChatPage(agentId, { limit: PAGE_SIZE });
      if (cancelled) return;
      setMessages(result.messages);
      setHasMore(result.hasMore);
      setInitialLoaded(true);

      if (result.messages.length > 0) {
        latestTimeRef.current = result.messages[result.messages.length - 1].time;
      }

      requestAnimationFrame(() => {
        scrollToBottom('instant');
      });
    };

    load();
    return () => { cancelled = true; };
  }, [active, agentId]);

  // Reset state when agentId changes or deactivated
  useEffect(() => {
    if (!active) {
      setInitialLoaded(false);
      setMessages([]);
      setHasMore(true);
      setNewMsgCount(0);
      setInputText('');
      latestTimeRef.current = null;
    }
  }, [active]);

  // Also reset when switching agents
  useEffect(() => {
    setInitialLoaded(false);
    setMessages([]);
    setHasMore(true);
    setNewMsgCount(0);
    setInputText('');
    latestTimeRef.current = null;
  }, [agentId]);

  // === Poll for new messages (non-intrusive) ===
  useEffect(() => {
    if (!active || !initialLoaded || !agentId) return;

    const poll = async () => {
      if (!activeRef.current || !latestTimeRef.current) return;
      if (sendingRef.current) return; // skip polling while a message is in-flight
      if (agentIdRef.current !== agentId) return; // guard against stale closure
      const newMsgs = await pollAgentNewMessages(agentId, latestTimeRef.current);
      if (!activeRef.current || agentIdRef.current !== agentId || newMsgs.length === 0) return;

      latestTimeRef.current = newMsgs[newMsgs.length - 1].time;

      setMessages(prev => {
        const existingTimes = new Set(prev.map(m => `${m.time}|${m.role}`));
        const truly = newMsgs.filter(m => !existingTimes.has(`${m.time}|${m.role}`));
        if (truly.length === 0) return prev;
        return [...prev, ...truly];
      });

      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'instant' });
        });
      } else {
        setNewMsgCount(c => c + newMsgs.length);
      }
    };

    pollTimerRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollTimerRef.current);
  }, [active, initialLoaded, agentId]);

  // === Load older messages on scroll to top ===
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore || messages.length === 0 || !agentId) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const oldestTime = messages[0]?.time;
    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight || 0;

    try {
      const result = await fetchAgentChatPage(agentId, { before: oldestTime, limit: PAGE_SIZE });
      if (result.messages.length > 0) {
        setMessages(prev => [...result.messages, ...prev]);
        setHasMore(result.hasMore);

        requestAnimationFrame(() => {
          if (el) {
            const newScrollHeight = el.scrollHeight;
            el.scrollTop = newScrollHeight - prevScrollHeight;
          }
        });
      } else {
        setHasMore(false);
      }
    } finally {
      setLoadingOlder(false);
      loadingOlderRef.current = false;
    }
  }, [hasMore, messages, agentId, fetchAgentChatPage]);

  // === Scroll event handler ===
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const atBottom = checkIfAtBottom();
    if (atBottom !== isAtBottomRef.current) {
      setIsAtBottom(atBottom);
      if (atBottom) setNewMsgCount(0);
    }

    if (el.scrollTop < 100 && hasMore && !loadingOlderRef.current) {
      loadOlderMessages();
    }
  }, [checkIfAtBottom, hasMore, loadOlderMessages]);

  // === Send message ===
  const handleSend = async () => {
    if (!inputText.trim() || sending || !agentId) return;
    const text = inputText.trim();
    setInputText('');
    setSending(true);
    sendingRef.current = true; // pause polling while sending

    const now = new Date().toISOString();
    // Optimistic update — add the boss message immediately
    setMessages(prev => [...prev, { role: 'boss', content: text, time: now }]);
    latestTimeRef.current = now;

    requestAnimationFrame(() => scrollToBottom('smooth'));

    try {
      const data = await chatWithAgent(agentId, text);

      // Only append the agent's reply; do NOT replace the whole list with
      // chatHistory, because that would lose any older messages the user
      // has already lazy-loaded, and could cause duplication with the
      // optimistic boss message we just added.
      if (data.reply) {
        const reply = data.reply;
        const replyContent = typeof reply === 'string' ? reply : (reply.reply || reply.content || reply);
        const replyTime = reply.time || new Date().toISOString();
        setMessages(prev => [...prev, {
          role: 'agent', content: replyContent, time: replyTime,
        }]);
        latestTimeRef.current = replyTime;
      } else if (data.chatHistory && data.chatHistory.length > 0) {
        // Fallback: if there's no standalone reply but chatHistory is provided,
        // find any messages newer than our optimistic boss message and append them.
        const cutoff = new Date(now).getTime();
        const newer = data.chatHistory.filter(m =>
          m.role === 'agent' && new Date(m.time).getTime() >= cutoff
        );
        if (newer.length > 0) {
          setMessages(prev => {
            const existingKeys = new Set(prev.map(m => `${m.time}|${m.role}`));
            const toAdd = newer.filter(m => !existingKeys.has(`${m.time}|${m.role}`));
            return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
          });
          latestTimeRef.current = newer[newer.length - 1].time;
        }
      }

      // Auto-scroll to bottom after agent reply
      requestAnimationFrame(() => scrollToBottom('smooth'));
    } catch (err) {
      const errTime = new Date().toISOString();
      setMessages(prev => [...prev, {
        role: 'agent',
        content: `😵 ${t('agentChat.error')}: ${err.message}`,
        time: errTime,
      }]);
      latestTimeRef.current = errTime;
    }

    setSending(false);
    sendingRef.current = false; // resume polling
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!company || !agentId) return null;

  return (
    <>
      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto px-4 py-3 space-y-3 relative"
        onScroll={handleScroll}
      >
        {/* Loading older indicator */}
        {loadingOlder && (
          <div className="text-center py-2">
            <span className="text-xs text-[var(--muted)] animate-pulse">{t('chat.loadingOlder')}</span>
          </div>
        )}

        {/* No more history indicator */}
        {!hasMore && messages.length > 0 && (
          <div className="text-center py-2">
            <span className="text-[10px] text-[var(--muted)]">— {t('chat.noMoreHistory')} —</span>
          </div>
        )}

        {/* Empty state */}
        {initialLoaded && messages.length === 0 && !sending && (
          <div className="text-center text-[var(--muted)] py-8">
            <div className="text-3xl">👋</div>
            <p className="text-sm mt-2">{t('agentChat.empty', { name: agentName })}</p>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, i) => (
          <MessageBubble
            key={`${msg.time}-${msg.role}-${i}`}
            isMe={msg.role === 'boss'}
            avatar={msg.role !== 'boss' ? agentAvatar : null}
            name={msg.role === 'boss' ? bossName : agentName}
            content={msg.content}
            time={msg.time}
            agentId={msg.role !== 'boss' ? agentId : null}
            onClickAvatar={onClickAvatar}
            bossAvatar={bossAvatar}
          />
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="flex gap-2">
            {agentAvatar ? (
              <CachedAvatar src={agentAvatar} alt="" className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs shrink-0">💬</div>
            )}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
              <span className="animate-pulse text-[var(--muted)]">{t('agentChat.typing')}</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* "Jump to bottom" / "New messages" floating button */}
      {!isAtBottom && initialLoaded && (
        <div className="relative">
          <button
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-2 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-xs font-medium shadow-lg hover:opacity-90 transition-all animate-fade-in"
          >
            {newMsgCount > 0 ? `${t('chat.newMessages')} (${newMsgCount})` : t('chat.scrollToBottom')}
            <span className="text-sm">↓</span>
          </button>
        </div>
      )}

      {/* Input area */}
      <ChatInput
        value={inputText}
        onChange={setInputText}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
        sending={sending}
        placeholder={t('agentChat.inputPlaceholder', { name: agentName })}
      />
    </>
  );
}
