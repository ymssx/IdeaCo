'use client';

import ProviderGrid from './ProviderGrid';

export default function ProvidersBoard() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <ProviderGrid
        showHeader
        showDescription
        showSecretary
        showStatusDot
      />
    </div>
  );
}
