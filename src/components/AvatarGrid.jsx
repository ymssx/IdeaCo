'use client';

/**
 * AvatarGrid - 通用头像选择网格组件
 * 方形网格视图，选中后主色调高亮背景，点击即选
 */
export default function AvatarGrid({ choices = [], selectedId, onSelect, cols = 8, gap = 'gap-1.5' }) {
  return (
    <div className={`grid ${gap} overflow-auto pr-1`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {choices.map((choice) => (
        <button
          key={choice.id}
          onClick={() => onSelect(choice)}
          className={`relative aspect-square rounded-lg transition-all overflow-hidden ${
            selectedId === choice.id
              ? 'bg-[var(--accent)] p-1 scale-[1.02]'
              : 'bg-[var(--border)] hover:bg-[var(--accent)]/30 hover:scale-[1.03]'
          }`}
        >
          <img
            src={choice.url}
            alt="avatar"
            className="w-full h-full object-cover rounded-md"
          />
        </button>
      ))}
    </div>
  );
}
