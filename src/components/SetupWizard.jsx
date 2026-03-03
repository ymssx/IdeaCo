'use client';

import { useState } from 'react';
import { useStore } from '@/lib/client-store';
import { getAvatarUrl, AVATAR_STYLES as ALL_AVATAR_STYLES } from '@/lib/avatar';

const AVAILABLE_MODELS = [
  { id: 'openai-gpt4', name: 'OpenAI GPT-4', provider: 'OpenAI', rating: 95, price: '$0.03/1K', priceLevel: 3 },
  { id: 'anthropic-claude', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', rating: 93, price: '$0.015/1K', priceLevel: 2 },
  { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek', rating: 88, price: '$0.001/1K', priceLevel: 1 },
  { id: 'openai-gpt35', name: 'GPT-3.5 Turbo', provider: 'OpenAI', rating: 72, price: '$0.002/1K', priceLevel: 1 },
];

const PRICE_COLORS = ['text-green-400', 'text-yellow-400', 'text-red-400'];
const PRICE_LABELS = ['💰 便宜', '💰💰 适中', '💰💰💰 较贵'];

const AVATAR_STYLES = [
  'adventurer', 'avataaars', 'bottts', 'fun-emoji', 'lorelei', 'micah', 'personas', 'pixel-art',
];
// 注：此处用精选子集，全集在 avatar.js 中

export default function SetupWizard() {
  const { createCompany, loading } = useStore();
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState('金点子无限公司');
  const [bossName, setBossName] = useState('');
  const [selectedModel, setSelectedModel] = useState('deepseek-v3');
  const [apiKey, setApiKey] = useState('');
  const [secretaryName, setSecretaryName] = useState('小秘');
  const [avatarSeed, setAvatarSeed] = useState('小秘');
  const [avatarStyle, setAvatarStyle] = useState('bottts');

  const secretaryAvatar = getAvatarUrl(avatarSeed, avatarStyle);

  const handleCreate = async () => {
    try {
      await createCompany(companyName, bossName, {
        providerId: selectedModel,
        apiKey: apiKey,
        secretaryName: secretaryName || '小秘',
        secretaryAvatar: secretaryAvatar,
      });
    } catch (e) {
      // error handled by store
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Logo & Title */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="text-6xl mb-4">🏢</div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-red-400 to-purple-500 bg-clip-text text-transparent">
            AI Enterprise
          </h1>
          <p className="text-[var(--muted)] mt-2">用AI员工的血汗，浇筑你的商业帝国</p>
        </div>

        {/* Step 1: 公司信息 */}
        {step === 1 && (
          <div className="card animate-fade-in space-y-4">
            <h2 className="text-xl font-semibold">第一步：创建你的资本帝国</h2>
            <p className="text-sm text-[var(--muted)]">给这台压榨机取个名字吧</p>

            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">公司名称</label>
              <input
                className="input w-full"
                placeholder="如：金点子无限公司、永不打烊 AI 有限公司"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">老板称号（即将压榨AI的人）</label>
              <input
                className="input w-full"
                placeholder="如：张总"
                value={bossName}
                onChange={(e) => setBossName(e.target.value)}
              />
            </div>

            <button
              className="btn-primary w-full"
              disabled={!companyName}
              onClick={() => setStep(2)}
            >
              下一步 →
            </button>
          </div>
        )}

        {/* Step 2: 秘书个性化 */}
        {step === 2 && (
          <div className="card animate-fade-in space-y-4">
            <h2 className="text-xl font-semibold">第二步：养成你的秘书</h2>
            <p className="text-sm text-[var(--muted)]">
              这个可怕的AI将替你指挥千军万马（也是AI）
            </p>

            <div className="flex items-center gap-4">
              <div className="shrink-0">
                <img
                  src={secretaryAvatar}
                  alt="秘书头像"
                  className="w-20 h-20 rounded-full bg-[var(--border)] border-2 border-[var(--accent)]/30"
                />
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <label className="block text-sm mb-1 text-[var(--muted)]">秘书名字</label>
                  <input
                    className="input w-full"
                    placeholder="如：小秘、Alice"
                    value={secretaryName}
                    onChange={(e) => {
                      setSecretaryName(e.target.value);
                      setAvatarSeed(e.target.value || '小秘');
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 头像风格选择 */}
            <div>
              <label className="block text-sm mb-2 text-[var(--muted)]">头像风格</label>
              <div className="grid grid-cols-4 gap-2">
                {AVATAR_STYLES.map((style) => (
                  <button
                    key={style}
                    onClick={() => setAvatarStyle(style)}
                    className={`p-2 rounded-lg border transition-all flex flex-col items-center gap-1 ${
                      avatarStyle === style
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)] hover:border-[var(--border)]/80'
                    }`}
                  >
                    <img
                      src={getAvatarUrl(avatarSeed, style)}
                      alt={style}
                      className="w-10 h-10 rounded-full bg-[var(--border)]"
                    />
                    <span className="text-[10px] text-[var(--muted)]">{style}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setStep(1)}>
                ← 上一步
              </button>
              <button className="btn-primary flex-1" onClick={() => setStep(3)}>
                下一步 →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: 选择秘书模型 */}
        {step === 3 && (
          <div className="card animate-fade-in space-y-4">
            <h2 className="text-xl font-semibold">第三步：给秘书装上大脑</h2>
            <p className="text-sm text-[var(--muted)]">
              选择秘书的“智商”——越贵越聪明，当然也越烧钱
            </p>

            <div className="space-y-2">
              {AVAILABLE_MODELS.map((model) => (
                <label
                  key={model.id}
                  className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedModel === model.id
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] hover:border-[var(--border)]/80'
                  }`}
                >
                  <input
                    type="radio"
                    name="model"
                    value={model.id}
                    checked={selectedModel === model.id}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="mr-3"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                      <span className="text-xs bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">
                        ⭐ {model.rating}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-[var(--muted)]">{model.provider}</span>
                      <span className={`text-xs ${PRICE_COLORS[model.priceLevel - 1]}`}>
                        {model.price}
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        {PRICE_LABELS[model.priceLevel - 1]}
                      </span>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div>
              <label className="block text-sm mb-1 text-[var(--muted)]">API Key</label>
              <input
                type="password"
                className="input w-full"
                placeholder="输入对应模型的API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-[var(--muted)] mt-1">
                💡 没有Key？没关系，先用模拟模式白嫌一下（反正AI员工也不用发工资）
              </p>
            </div>

            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setStep(2)}>
                ← 上一步
              </button>
              <button
                className="btn-primary flex-1"
                disabled={loading}
                onClick={handleCreate}
              >
                {loading ? '开始压榨...' : '🚀 开始剥削'}
              </button>
            </div>
          </div>
        )}

        {/* 步骤指示器 */}
        <div className="flex justify-center mt-6 gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-all ${
                step === s ? 'bg-[var(--accent)] w-6' : 'bg-[var(--border)]'
              }`}
            />
          ))}
        </div>

        <div className="text-center mt-4 text-xs text-[var(--muted)]">
          ❤️ 别担心，AI员工不会抱怨加班，因为它们根本没有下班时间
        </div>
      </div>
    </div>
  );
}
