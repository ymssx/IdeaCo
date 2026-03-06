'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/lib/client-store';
import { useI18n } from '@/lib/i18n';
import CachedAvatar from './CachedAvatar';
import ProvidersBoard from './ProvidersBoard';

/**
 * OnboardingGuide — Game-style onboarding with secretary avatar and speech bubbles.
 * 
 * Flow:
 *   Step 0: Secretary introduces herself, greets the boss
 *   Step 1: Open providers board in a modal, let user configure providers
 *   Step 2: Tell user they can create departments and assign tasks
 *   Step 3: Done — dismiss guide
 */
export default function OnboardingGuide({ onComplete }) {
  const { company, setActiveTab } = useStore();
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [showProviders, setShowProviders] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const typeTimerRef = useRef(null);

  const secretary = company?.secretary;
  const secretaryName = secretary?.name || t('chat.secretary');
  const secretaryAvatar = secretary?.avatar || '';

  // Get current step's dialogue text
  const getDialogue = useCallback((s) => {
    const dialogues = t('onboarding.dialogues');
    if (Array.isArray(dialogues) && dialogues[s]) {
      return dialogues[s].replace('{bossName}', company?.bossName || 'Boss').replace('{secretaryName}', secretaryName);
    }
    return '';
  }, [t, company?.bossName, secretaryName]);

  // Typewriter effect
  useEffect(() => {
    const text = getDialogue(step);
    if (!text) return;

    setTypedText('');
    setIsTyping(true);
    let index = 0;

    const type = () => {
      if (index < text.length) {
        setTypedText(text.slice(0, index + 1));
        index++;
        typeTimerRef.current = setTimeout(type, 30);
      } else {
        setIsTyping(false);
      }
    };

    typeTimerRef.current = setTimeout(type, 500);
    return () => { if (typeTimerRef.current) clearTimeout(typeTimerRef.current); };
  }, [step, getDialogue]);

  // Skip typewriter — show full text
  const skipTyping = () => {
    if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    setTypedText(getDialogue(step));
    setIsTyping(false);
  };

  const handleNext = () => {
    if (isTyping) {
      skipTyping();
      return;
    }
    if (step === 1) {
      // Open providers modal
      setShowProviders(true);
      return;
    }
    if (step === 2) {
      // Final step — done
      onComplete();
      return;
    }
    setStep(s => s + 1);
  };

  const handleProvidersClose = () => {
    setShowProviders(false);
    setStep(2);
  };

  const getButtonText = () => {
    if (isTyping) return t('onboarding.clickToContinue');
    if (step === 0) return t('onboarding.nextBtn');
    if (step === 1) return t('onboarding.configureBtn');
    if (step === 2) return t('onboarding.startBtn');
    return t('common.next');
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/70 z-[100] flex flex-col items-center justify-end transition-all">
        {/* Speech bubble area */}
        <div className="w-full max-w-2xl px-6 mb-4 animate-fade-in">
          {/* Bubble */}
          <div
            className="relative bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-bl-md p-5 shadow-2xl cursor-pointer select-none"
            onClick={handleNext}
          >
            {/* Secretary name tag */}
            <div className="absolute -top-3 left-4 px-3 py-0.5 bg-[var(--accent)] text-white text-xs rounded-full font-medium shadow-lg">
              {secretaryName}
            </div>
            {/* Dialogue text */}
            <p className="text-sm leading-relaxed whitespace-pre-line mt-1 min-h-[3rem]">
              {typedText}
              {isTyping && <span className="inline-block w-0.5 h-4 bg-[var(--accent)] ml-0.5 animate-pulse align-middle" />}
            </p>
            {/* Action button */}
            <div className="flex justify-end mt-3">
              <button
                onClick={(e) => { e.stopPropagation(); handleNext(); }}
                className="px-4 py-1.5 bg-[var(--accent)] text-white text-sm rounded-lg hover:opacity-90 transition-all shadow-lg"
              >
                {getButtonText()}
              </button>
            </div>
            {/* Skip */}
            {step < 2 && (
              <button
                onClick={(e) => { e.stopPropagation(); onComplete(); }}
                className="absolute top-2 right-3 text-[10px] text-[var(--muted)] hover:text-white transition-all"
              >
                {t('onboarding.skip')}
              </button>
            )}
          </div>
          {/* Bubble tail */}
          <div className="ml-10 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[12px] border-t-[var(--card)]" />
        </div>

        {/* Secretary avatar at the bottom */}
        <div className="flex items-end gap-3 pb-8 animate-bounce-in">
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute -inset-2 rounded-full bg-[var(--accent)]/20 blur-lg animate-pulse" />
            <CachedAvatar
              src={secretaryAvatar}
              alt={secretaryName}
              className="w-28 h-28 rounded-full border-3 border-[var(--accent)] shadow-2xl relative z-10 bg-[var(--card)]"
            />
            {/* Online indicator */}
            <div className="absolute bottom-1 right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[var(--card)] z-20" />
          </div>
        </div>

        {/* Step dots */}
        <div className="flex gap-2 pb-4">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all ${
                step === i ? 'bg-[var(--accent)] w-5' : step > i ? 'bg-[var(--accent)]/50' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Providers Board Modal */}
      {showProviders && (
        <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center !m-0" onClick={handleProvidersClose}>
          <div
            className="bg-[var(--background)] rounded-2xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-y-auto shadow-2xl border border-[var(--border)] animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Header with close button */}
            <div className="sticky top-0 bg-[var(--background)] border-b border-[var(--border)] px-6 py-3 flex items-center justify-between z-10 rounded-t-2xl">
              <div>
                <h2 className="text-lg font-bold">{t('onboarding.providersTitle')}</h2>
                <p className="text-xs text-[var(--muted)]">{t('onboarding.providersDesc')}</p>
              </div>
              <button
                onClick={handleProvidersClose}
                className="px-4 py-1.5 bg-[var(--accent)] text-white text-sm rounded-lg hover:opacity-90 transition-all"
              >
                {t('onboarding.providersDone')}
              </button>
            </div>
            <ProvidersBoard />
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes bounce-in {
          0% { transform: translateY(100px); opacity: 0; }
          50% { transform: translateY(-10px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .animate-bounce-in {
          animation: bounce-in 0.6s ease-out forwards;
        }
      `}</style>
    </>
  );
}
