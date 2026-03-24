'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl } from '@/lib/avatar';
import { useI18n } from '@/lib/i18n';
import { MessageBubble, ChatInput, TaskStatusPanel } from './ChatShared';

// How many messages to load per page
const PAGE_SIZE = 30;
// How close to the bottom (px) to consider "at bottom"
const BOTTOM_THRESHOLD = 80;

/**
 * Shared secretary chat view used by both ChatPanel (sidebar) and Mailbox (message page).
 *
 * Features:
 * - Initial load: fetches last PAGE_SIZE messages, scrolls to bottom instantly
 * - Polling: checks for new messages every 2s via `after` cursor, appends without scrolling
 * - Scroll up: lazy-loads older messages, preserves scroll position
 * - "Jump to bottom" button when user scrolls away from bottom
 * - Windowed rendering: only keeps a sliding window of messages in DOM
 *
 * Props:
 *   - active: boolean — whether this view is currently visible/active (controls polling)
 *   - onViewDepartment: function — optional callback for action buttons
 *   - onViewRequirement: function — optional callback for action buttons
 */
export default function SecretaryChatView({ active = true, onViewDepartment, onViewRequirement }) {
  const {
    company, chatWithSecretaryStream,
    streamingContent, streamingThinking, isStreaming,
    fetchSecretaryChatPage, pollSecretaryNewMessages,
  } = useStore();
  const { t } = useI18n();

  // === State ===
  const [messages, setMessages] = useState([]);       // Current visible messages window
  const [message, setMessage] = useState('');          // Input text
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);        // Are there older messages?
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);   // Is user scrolled to bottom?
  const [newMsgCount, setNewMsgCount] = useState(0);    // Unread new messages while scrolled away

  // === Refs ===
  const scrollContainerRef = useRef(null);
  const bottomRef = useRef(null);
  const latestTimeRef = useRef(null);      // Timestamp of the most recent message (for polling cursor)
  const loadingOlderRef = useRef(false);   // Guard against concurrent loads
  const isAtBottomRef = useRef(true);      // Sync ref for use in callbacks
  const activeRef = useRef(active);
  const pollTimerRef = useRef(null);
  const sendingRef = useRef(false);        // Pause polling while sending to avoid duplication

  const secretary = company?.secretary;
  const bossName = company?.boss;
  const bossAvatar = company?.bossAvatar;

  // Keep ref in sync
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { isAtBottomRef.current = isAtBottom; }, [isAtBottom]);

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
    if (!active || !company) return;
    let cancelled = false;

    const load = async () => {
      const result = await fetchSecretaryChatPage({ limit: PAGE_SIZE });
      if (cancelled) return;
      setMessages(result.messages);
      setHasMore(result.hasMore);
      setInitialLoaded(true);

      // Track latest message time for polling
      if (result.messages.length > 0) {
        latestTimeRef.current = result.messages[result.messages.length - 1].time;
      }

      // Scroll to bottom after initial render
      requestAnimationFrame(() => {
        scrollToBottom('instant');
      });
    };

    load();
    return () => { cancelled = true; };
  }, [active, company?.id]); // Reset when chat becomes active or company changes

  // Reset state when deactivated
  useEffect(() => {
    if (!active) {
      setInitialLoaded(false);
      setMessages([]);
      setHasMore(true);
      setNewMsgCount(0);
      latestTimeRef.current = null;
    }
  }, [active]);

  // === Poll for new messages (non-intrusive) ===
  useEffect(() => {
    if (!active || !initialLoaded) return;

    const poll = async () => {
      if (!activeRef.current || !latestTimeRef.current) return;
      if (sendingRef.current) return; // Skip polling while a message is in-flight
      const newMsgs = await pollSecretaryNewMessages(latestTimeRef.current);
      if (!activeRef.current || newMsgs.length === 0) return;

      // Update latest time cursor
      latestTimeRef.current = newMsgs[newMsgs.length - 1].time;

      setMessages(prev => {
        // Deduplicate by time+role (simple heuristic)
        const existingTimes = new Set(prev.map(m => `${m.time}|${m.role}`));
        const truly = newMsgs.filter(m => !existingTimes.has(`${m.time}|${m.role}`));
        if (truly.length === 0) return prev;
        return [...prev, ...truly];
      });

      // If user is at bottom, auto-scroll; otherwise increment unread counter
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
  }, [active, initialLoaded]);

  // === Load older messages on scroll to top ===
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore || messages.length === 0) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const oldestTime = messages[0]?.time;
    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight || 0;

    try {
      const result = await fetchSecretaryChatPage({ before: oldestTime, limit: PAGE_SIZE });
      if (result.messages.length > 0) {
        setMessages(prev => [...result.messages, ...prev]);
        setHasMore(result.hasMore);

        // Preserve scroll position: after prepending, restore the relative scroll offset
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
  }, [hasMore, messages, fetchSecretaryChatPage]);

  // === Scroll event handler ===
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // Track bottom state
    const atBottom = checkIfAtBottom();
    if (atBottom !== isAtBottomRef.current) {
      setIsAtBottom(atBottom);
      if (atBottom) setNewMsgCount(0);
    }

    // Trigger load-older when near top
    if (el.scrollTop < 100 && hasMore && !loadingOlderRef.current) {
      loadOlderMessages();
    }
  }, [checkIfAtBottom, hasMore, loadOlderMessages]);

  // === Send message ===
  const handleSend = async () => {
    if (!message.trim() || sending) return;
    const msg = message.trim();
    setMessage('');
    setSending(true);
    sendingRef.current = true; // Pause polling while sending

    const now = new Date().toISOString();
    // Optimistic update
    setMessages(prev => [...prev, { role: 'boss', content: msg, time: now }]);
    latestTimeRef.current = now;

    // Scroll to bottom so user can see their own message
    requestAnimationFrame(() => scrollToBottom('smooth'));

    try {
      const finalReply = await chatWithSecretaryStream(msg, {
        onError: (errMsg) => {
          const errTime = new Date().toISOString();
          setMessages(prev => [...prev, {
            role: 'secretary',
            content: `${t('chat.errorPrefix')}${errMsg}`,
            time: errTime,
          }]);
          latestTimeRef.current = errTime;
        },
      });

      // After streaming completes, chatWithSecretaryStream calls fetchCompany()
      // which persists boss msg + secretary reply on the server.
      // Reload the latest page so our local messages use server timestamps
      // (avoids client/server time mismatch causing duplicates on next poll).
      const result = await fetchSecretaryChatPage({ limit: PAGE_SIZE });
      setMessages(result.messages);
      setHasMore(result.hasMore);
      if (result.messages.length > 0) {
        latestTimeRef.current = result.messages[result.messages.length - 1].time;
      }
      requestAnimationFrame(() => scrollToBottom('smooth'));
    } catch (e) {
      if (!isStreaming) {
        const errTime = new Date().toISOString();
        setMessages(prev => [...prev, {
          role: 'secretary',
          content: `${t('chat.errorPrefix')}${e.message}`,
          time: errTime,
        }]);
        latestTimeRef.current = errTime;
      }
    }
    setSending(false);
    sendingRef.current = false; // Resume polling
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!company) return null;

  return (
    <>
      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-3 space-y-3 relative"
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
          <div className="text-center py-8">
            <div className="text-4xl mb-2">💬</div>
            <p className="text-sm text-[var(--muted)]">
              {t('chat.welcome', { name: secretary?.name || t('setup.defaultSecretary') })}
            </p>
            <div className="mt-3 space-y-1 max-w-xs mx-auto">
              {t('chat.suggestions').map((q, i) => (
                <button
                  key={i}
                  className="block w-full text-xs text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--muted)] hover:text-white transition-all"
                  onClick={() => setMessage(q)}
                >
                  💡 {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, i) => (
          <MessageBubble
            key={`${msg.time}-${msg.role}-${i}`}
            isMe={msg.role === 'boss'}
            avatar={msg.role === 'secretary' ? (secretary?.avatar || getAvatarUrl('secretary')) : null}
            name={msg.role === 'boss' ? bossName : (secretary?.name || t('setup.defaultSecretary'))}
            content={msg.content}
            time={msg.time}
            action={msg.action}
            agentId={null}
            onClickAvatar={null}
            bossAvatar={bossAvatar}
            onViewDepartment={onViewDepartment}
            onViewRequirement={onViewRequirement}
            channel={msg.channel}
          />
        ))}

        {/* Streaming thinking bubble */}
        {isStreaming && streamingThinking && (
          <div className="flex gap-2">
            <img
              src={secretary?.avatar || getAvatarUrl('secretary')}
              alt={t('chat.secretary')}
              className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0"
            />
            <div className="bg-purple-900/20 border border-purple-500/30 rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[85%]">
              <div className="text-[10px] text-purple-400 mb-1 flex items-center gap-1">
                <span className="animate-pulse">💭</span> {t('chat.thinking')}
              </div>
              <div className="text-xs text-purple-300/70 whitespace-pre-wrap break-words">{streamingThinking}</div>
            </div>
          </div>
        )}

        {/* Streaming content bubble */}
        {isStreaming && streamingContent && (
          <div className="flex gap-2">
            <img
              src={secretary?.avatar || getAvatarUrl('secretary')}
              alt={t('chat.secretary')}
              className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0"
            />
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[85%]">
              <div className="whitespace-pre-wrap break-words">{streamingContent}<span className="animate-pulse">▍</span></div>
            </div>
          </div>
        )}

        {/* Typing indicator — only when no streaming content yet */}
        {sending && !isStreaming && (
          <div className="flex gap-2">
            <img
              src={secretary?.avatar || getAvatarUrl('secretary')}
              alt={t('chat.secretary')}
              className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0"
            />
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
              <span className="animate-pulse text-[var(--muted)]">{t('chat.typing')}</span>
            </div>
          </div>
        )}

        {sending && isStreaming && !streamingContent && !streamingThinking && (
          <div className="flex gap-2">
            <img
              src={secretary?.avatar || getAvatarUrl('secretary')}
              alt={t('chat.secretary')}
              className="w-7 h-7 rounded-full bg-[var(--border)] shrink-0"
            />
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
              <span className="animate-pulse text-[var(--muted)]">{t('chat.typing')}</span>
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

      {/* Task status panel */}
      <TaskStatusPanel />

      {/* Input area */}
      <ChatInput
        value={message}
        onChange={setMessage}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
        sending={sending}
        placeholder={t('chat.inputPlaceholder', { name: secretary?.name || t('setup.defaultSecretary') })}
      />
    </>
  );
}
