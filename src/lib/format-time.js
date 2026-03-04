
/**
 * Internationalized time formatting utility
 */

export function formatTimeI18n(time, t) {
  if (!time) return '';
  const d = new Date(time);
  const now = new Date();
  const diff = now - d;

  if (diff < 60 * 1000) return t('time.justNow');
  if (diff < 60 * 60 * 1000) return t('time.minutesAgo', { n: Math.floor(diff / 60000) });
  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = [t('time.sun'), t('time.mon'), t('time.tue'), t('time.wed'), t('time.thu'), t('time.fri'), t('time.sat')];
    return days[d.getDay()];
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
