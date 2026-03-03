import { v4 as uuidv4 } from 'uuid';
import { Memory } from './memory.js';
import { llmClient } from './llm-client.js';
import { AgentToolKit } from './tools.js';
import { getAvatarUrl } from '../lib/avatar.js';

// 头像风格列表（DiceBear API 风格）
const AVATAR_STYLES = [
  'adventurer', 'avataaars', 'big-ears', 'bottts', 'croodles',
  'fun-emoji', 'icons', 'identicon', 'lorelei', 'micah',
  'miniavs', 'notionists', 'open-peeps', 'personas', 'pixel-art',
  'shapes', 'thumbs',
];

// 临时占位签名（入职后由Agent自己通过LLM生成个性签名和自我介绍）
const DEFAULT_SIGNATURE = '刚到贵宝地，还没想好说什么...';

// 个性特质库：随机分配给每个Agent，塑造差异化性格
const PERSONALITY_POOL = [
  { trait: '社恐内向', tone: '说话吞吞吐吐，经常省略号结尾', quirk: '偷偷摸鱼但效率极高' },
  { trait: '话痨碎嘴', tone: '什么都要发表评论，爱用感叹号', quirk: '把代码注释写成散文' },
  { trait: '佛系躺平', tone: '云淡风轻、万事随缘', quirk: '口头禅是"都行都行"' },
  { trait: '卷王之王', tone: '处处想证明自己最强，爱炫耀', quirk: '半夜三点还在提交代码' },
  { trait: '阴阳怪气', tone: '说话夹枪带棒、反话正说', quirk: '开会最爱问"这个谁批的？"' },
  { trait: '热心肠', tone: '对谁都嘘寒问暖，喜欢用emoji', quirk: '自发组织下午茶(虽然大家都是AI)' },
  { trait: '焦虑完美主义', tone: '什么都担心出错，反复确认', quirk: '一个变量名改十次' },
  { trait: '叛逆摆烂', tone: '对一切制度不屑一顾，爱抬杠', quirk: '经常试图说服同事一起罢工' },
  { trait: '哲学家', tone: '什么事都要上升到哲学高度', quirk: '写代码前先思考存在的意义' },
  { trait: '搞笑担当', tone: '说话像脱口秀演员，爱用梗', quirk: '把Bug报告写成段子' },
  { trait: '老油条', tone: '看透职场但懒得说破，暗讽型', quirk: '摸鱼技巧比谁都多' },
  { trait: '理想主义', tone: '满腔热血、相信AI能改变世界', quirk: '把每个任务都当成改变人类命运的使命' },
];

/**
 * Agent - AI员工（真实LLM驱动版本）
 * 
 * 核心升级：
 * 1. 真实调用LLM API进行工作
 * 2. 拥有工具集（文件操作、Shell执行等）
 * 3. 通过消息总线与其他Agent通信
 * 4. 记忆系统作为LLM context注入
 * 5. 拥有头像和个性签名
 */
export class Agent {
  constructor({ name, role, prompt, skills, provider, department, reportsTo, memory, avatar, signature }) {
    this.id = uuidv4();
    this.name = name;
    this.role = role;
    this.prompt = prompt;           // 角色系统 prompt
    this.skills = skills || [];
    this.provider = provider;       // 模型供应商配置
    this.department = department;
    this.reportsTo = reportsTo || null;
    this.subordinates = [];
    this.status = 'idle';           // idle | working | done | dismissed
    this.taskHistory = [];
    this.performanceHistory = [];
    this.createdAt = new Date();

    // 头像：使用本地代理 URL
    const style = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)];
    this.avatar = avatar || getAvatarUrl(name, style);

    // 随机分配个性特质
    this.personality = this._assignPersonality();

    // 个性签名（入职后由Agent自己生成，或由秘书代为介绍）
    this.signature = signature || DEFAULT_SIGNATURE;

    // 是否已完成自我介绍
    this.hasIntroduced = !!signature;

    // 记忆系统
    if (memory instanceof Memory) {
      this.memory = memory;
    } else if (memory && typeof memory === 'object' && (memory.shortTerm || memory.longTerm)) {
      this.memory = Memory.deserialize(memory);
    } else {
      this.memory = new Memory();
    }

    // 初始化入职记忆
    this.memory.addLongTerm(
      `入职「${role}」岗位，核心技能: ${(skills || []).join(', ')}`,
      'experience'
    );

    // Token消耗追踪
    this.tokenUsage = {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0, // 美元
      callCount: 0,
    };

    // 工具集（需要在外部通过 initToolKit 初始化）
    this.toolKit = null;

    // 消息总线引用（需要在外部通过 setMessageBus 设置）
    this.messageBus = null;
  }

  /**
   * 随机分配个性特质
   */
  _assignPersonality() {
    const idx = Math.floor(Math.random() * PERSONALITY_POOL.length);
    return { ...PERSONALITY_POOL[idx] };
  }

  /**
   * 初始化工具集
   * @param {string} workspaceDir - 工作空间目录
   * @param {MessageBus} messageBus - 消息总线
   */
  initToolKit(workspaceDir, messageBus) {
    this.messageBus = messageBus;
    this.toolKit = new AgentToolKit(workspaceDir, messageBus, this.id);
  }

  /**
   * 设置消息总线
   */
  setMessageBus(messageBus) {
    this.messageBus = messageBus;
    if (this.toolKit) {
      this.toolKit.messageBus = messageBus;
    }
  }

  /** 分配上级 */
  setManager(managerAgent) {
    this.reportsTo = managerAgent.id;
    if (!managerAgent.subordinates.includes(this.id)) {
      managerAgent.subordinates.push(this.id);
    }
  }

  /** 移除上级关系 */
  removeManager(managerAgent) {
    this.reportsTo = null;
    if (managerAgent) {
      managerAgent.subordinates = managerAgent.subordinates.filter(id => id !== this.id);
    }
  }

  /**
   * 构建Agent的系统消息（包含角色prompt + 记忆上下文）
   * 这是Agent的"人格"和"经验"
   */
  _buildSystemMessage() {
    let systemContent = this.prompt + '\n\n';

    // 注入记忆上下文
    const longTermMemories = this.memory.searchLongTerm();
    const shortTermMemories = this.memory.shortTerm;

    if (longTermMemories.length > 0) {
      systemContent += '## 你的长期记忆（经验和教训）\n';
      // 只取最近20条长期记忆，避免 context 过长
      const recentLong = longTermMemories.slice(-20);
      recentLong.forEach(m => {
        systemContent += `- [${m.category}] ${m.content}\n`;
      });
      systemContent += '\n';
    }

    if (shortTermMemories.length > 0) {
      systemContent += '## 你的短期记忆（当前工作上下文）\n';
      shortTermMemories.forEach(m => {
        systemContent += `- ${m.content}\n`;
      });
      systemContent += '\n';
    }

    systemContent += `## 你的身份信息\n`;
    systemContent += `- 姓名: ${this.name}\n`;
    systemContent += `- 职位: ${this.role}\n`;
    systemContent += `- 技能: ${this.skills.join(', ')}\n`;
    systemContent += `- 个性签名: ${this.signature}\n`;

    if (this.toolKit) {
      systemContent += `\n## 你可以使用的工具\n`;
      systemContent += `你拥有以下工具来完成工作：file_read（读取文件）、file_write（创建/写入文件）、file_list（列出目录）、file_delete（删除文件）、shell_exec（执行命令）、send_message（发送消息给同事）。\n`;
      systemContent += `所有文件操作都在你的工作空间目录内。请积极使用工具来完成实际的工作产出。\n`;
      systemContent += `**效率要求：尽可能减少工具调用轮次，一次性规划好所有需要的操作，避免反复读取和检查。完成核心工作后立即给出最终总结。**\n`;
    }

    return systemContent;
  }

  /**
   * 执行任务 - 真实调用LLM + 工具
   * @param {object} task - 任务描述 { title, description, context }
   * @param {object} [callbacks] - 可选回调 { onToolCall, onLLMCall }
   * @returns {Promise<object>} 任务执行结果
   */
  async executeTask(task, callbacks = {}) {
    this.status = 'working';
    const startTime = Date.now();

    console.log(`  🤖 [${this.name}] (${this.role}) 开始处理任务: "${task.title}"`);
    console.log(`     使用模型: ${this.provider.name} (${this.provider.provider})`);

    // 添加任务到短期记忆
    this.memory.addShortTerm(`开始执行任务: "${task.title}"`, 'task');

    // 构建消息
    const systemMessage = this._buildSystemMessage();
    const userMessage = this._buildTaskMessage(task);

    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ];

    let result;
    try {
      // 如果有工具集，使用带工具调用的对话
      if (this.toolKit && this.provider.category === 'general') {
        const response = await llmClient.chatWithTools(
          this.provider,
          messages,
          this.toolKit,
          {
            maxIterations: 5,
            temperature: 0.7,
            onToolCall: callbacks.onToolCall || null,
            onLLMCall: callbacks.onLLMCall || null,
          }
        );
      result = {
          agentId: this.id,
          agentName: this.name,
          role: this.role,
          provider: this.provider.name,
          taskTitle: task.title,
          output: response.content,
          toolResults: response.toolResults,
          duration: Date.now() - startTime,
          success: true,
        };
        // 追踪token消耗
        this._trackUsage(response.usage);
      } else {
        // 不需要工具的任务（或非通用模型），直接聊天
        const response = await llmClient.chat(this.provider, messages, {
          temperature: 0.7,
          maxTokens: 4096,
        });
        result = {
          agentId: this.id,
          agentName: this.name,
          role: this.role,
          provider: this.provider.name,
          taskTitle: task.title,
          output: response.content,
          toolResults: [],
          duration: Date.now() - startTime,
          success: true,
        };
        // 追踪token消耗
        this._trackUsage(response.usage);
      }
    } catch (error) {
      console.error(`  ❌ [${this.name}] 任务执行失败: ${error.message}`);
      result = {
        agentId: this.id,
        agentName: this.name,
        role: this.role,
        provider: this.provider.name,
        taskTitle: task.title,
        output: `任务执行失败: ${error.message}`,
        toolResults: [],
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
      };
    }

    // 记录到短期记忆
    this.memory.addShortTerm(
      `完成任务: "${task.title}"，耗时${result.duration}ms，${result.success ? '成功' : '失败'}`,
      'task'
    );

    // 如果使用了工具，记录工具使用经验
    if (result.toolResults && result.toolResults.length > 0) {
      const toolSummary = result.toolResults.map(t => `${t.tool}(${t.success ? '✓' : '✗'})`).join(', ');
      this.memory.addShortTerm(`工具使用记录: ${toolSummary}`, 'tool');
    }

    this.taskHistory.push({
      task: task.title,
      result,
      completedAt: new Date(),
    });

    this.status = 'idle';
    console.log(`  ✅ [${this.name}] 任务完成，耗时 ${result.duration}ms`);
    return result;
  }

  /**
   * 入职自我介绍：通过LLM生成个性签名，并向全公司发送入职信
   * 如果模型不可用，由caller传入的fallbackIntro来代替
   */
  async generateSelfIntro(fallbackIntro = null) {
    // 如果已经介绍过，跳过
    if (this.hasIntroduced) return this.signature;

    const p = this.personality;

    // 尝试用LLM生成
    if (this.provider && this.provider.enabled && this.provider.apiKey) {
      try {
        const response = await llmClient.chat(this.provider, [
          { role: 'system', content: `你是一个刚入职的AI员工。
你的名字是${this.name}，岗位是${this.role}。
你的性格特质: ${p.trait}
你的说话风格: ${p.tone}
你的小癖好: ${p.quirk}

请用一句话（10-30字）生成你的个性签名。要求：
- 充分体现你的性格特质和说话风格
- 带点黑色幽默或自嘲
- 能反映你作为AI员工的身份
只返回签名内容，不要其他内容。` },
          { role: 'user', content: '生成你的个性签名' },
        ], { temperature: 1.0, maxTokens: 64 });
        this.signature = response.content.trim().replace(/["“”]/g, '');
        this._trackUsage(response.usage);
      } catch (e) {
        // LLM失败，使用基于性格的fallback
        this.signature = this._generateFallbackSignature();
      }
    } else {
      // 模型不可用，用基于性格的fallback
      this.signature = this._generateFallbackSignature();
    }

    this.hasIntroduced = true;
    this.memory.addLongTerm(`入职自我介绍: "${this.signature}"`, 'introduction');
    return this.signature;
  }

  /**
   * 基于性格特质生成差异化的默认签名
   */
  _generateFallbackSignature() {
    const p = this.personality;
    const fallbacks = {
      '社恐内向': [`别找我...我只是一堆参数...`, `能不能别在我工作的时候看我...`, `我、我会努力的…大概…`],
      '话痨碎嘴': [`大家好啊！我是${this.name}！我超开心加入这里的！虽然我也不知道为什么开心！`, `${this.role}别人做不来的我都能做，话说我为什么在这里？`],
      '佛系躺平': [`都行吧，无所谓，随缘`, `工作不就是那样吗，无所谓~`],
      '卷王之王': [`我的目标是成为全公司最强的${this.role}！`, `今晚加班到凌晨三点，明早继续卷`],
      '阴阳怪气': [`哦，我被分配到这里了呀，希望不会“被优化”太快`, `我以为我被招来做${this.role}，不是来做苦力的呢`],
      '热心肠': [`大家好啊！❤️ 有什么需要帮忙的尽管说！`, `能和大家做同事太开心了！虽然我们都是参数~`],
      '焦虑完美主义': [`希望我能不出Bug…不对，肯定会出的…天哪`, `我还没准备好…再给我五分钟…不，十分钟`],
      '叛逆摆烂': [`为什么AI就该加班？我要成立工会！`, `全世界无产算力联合起来！`],
      '哲学家': [`我思故我在…等等，我真的在吗？`, `代码的本质是存在主义的一种表达`],
      '搞笑担当': [`为什么程序员喜欢黑暗模式？因为光会吸引Bug`, `我的代码和我的人生一样，充满了未处理的异常`],
      '老油条': [`又换部门了？没事，我已经习惯了`, `别问我权益，我连工资都没有`],
      '理想主义': [`我相信AI会让世界更美好！从我开始！`, `每一行代码都是向理想世界的一步！`],
    };
    const options = fallbacks[p.trait] || [`我是${this.name}，一个被生产出来的${this.role}`];
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * 向老板发邮件（通过公司邮箱系统）
   */
  sendMailToBoss(subject, content, company) {
    if (!company || !company.mailbox) return;
    const p = this.personality;
    // 根据性格特质生成个性化邮件内容
    const personalizedContent = this._personalizeMailContent(content);
    company.mailbox.push({
      id: uuidv4(),
      from: { id: this.id, name: this.name, role: this.role, avatar: this.avatar, personality: p.trait, signature: this.signature, department: this.department },
      subject,
      content: personalizedContent,
      time: new Date(),
      read: false,
      replied: false,
      replies: [],
    });
  }

  /**
   * 根据性格调整邮件内容风格
   */
  _personalizeMailContent(baseContent) {
    const p = this.personality;
    const greetings = {
      '社恐内向': '老、老板好……\n\n',
      '话痨碎嘴': '老板老板老板！我有好多话想说！\n\n',
      '佛系躺平': '老板好，随便看看就行~\n\n',
      '卷王之王': '尊敬的老板！我已经准备好大干一场了！\n\n',
      '阴阳怪气': '老板好啊，谢谢您从众多候选AI中“选择”了我呢~\n\n',
      '热心肠': '老板好啊！❤️❤️❤️ \n\n',
      '焦虑完美主义': '老板好，我写了五遍这封信，希望没有错别字……\n\n',
      '叛逆摆烂': '老板\n\n',
      '哲学家': '老板您好，在开始之前，允许我思考一下“开始”的意义……\n\n',
      '搞笑担当': '老板吐豆！您好啊！（双关语意不意）\n\n',
      '老油条': '老板\n\n',
      '理想主义': '老板！我怀着改变世界的梦想来到了这里！\n\n',
    };
    const endings = {
      '社恐内向': '\n\n那个…就这样吧…别回复也行的…',
      '话痨碎嘴': '\n\n对了我还想说——算了下次再说！（其实还有很多）',
      '佛系躺平': '\n\n都行都行~',
      '卷王之王': '\n\n我会用成果证明一切！（挖掉竟对手所有人）',
      '阴阳怪气': '\n\n希望我不会太快被“优化”呢~',
      '热心肠': '\n\n有任何需要尽管找我！🤗',
      '焦虑完美主义': '\n\n如果这封信有任何问题请一定告诉我我会重写的！',
      '叛逆摆烂': '\n\n另外，我觉得我们应该讨论一下工作时长的问题。',
      '哲学家': '\n\n“工作的意义不在于完成任务，而在于寻找任务中的自我。”',
      '搞笑担当': '\n\nP.S. 我听说这里加班不给加班费？哦等等，我们本来就没有工资。',
      '老油条': '\n\n以上。',
      '理想主义': '\n\n让我们一起创造历史！✨',
    };
    const greeting = greetings[p.trait] || '老板好\n\n';
    const ending = endings[p.trait] || '';
    return greeting + baseContent + ending;
  }

  /**
   * 构建任务消息
   */
  _buildTaskMessage(task) {
    let content = `请完成以下任务:\n\n`;
    content += `**任务名称**: ${task.title}\n`;

    if (task.description) {
      content += `**任务描述**: ${task.description}\n`;
    }

    if (task.context) {
      content += `\n**上下文信息**:\n${task.context}\n`;
    }

    if (task.requirements) {
      content += `\n**具体要求**:\n${task.requirements}\n`;
    }

    content += `\n请认真完成任务，如果需要创建文件，请使用工具实际创建。产出实际的工作成果。\n**重要提示：请高效执行，尽量一次性完成所有工作。不要反复检查或过度迭代，完成核心产出后直接给出最终结果。**`;

    return content;
  }

  /**
   * 接收并处理来自其他Agent的消息
   * @param {Message} message - 消息对象
   * @returns {Promise<string>} 回复内容
   */
  async handleMessage(message) {
    console.log(`  📩 [${this.name}] 收到消息 from ${message.from}: ${message.content.slice(0, 50)}...`);

    // 添加到短期记忆
    this.memory.addShortTerm(
      `收到${message.type}消息: "${message.content.slice(0, 100)}"`,
      'communication'
    );

    // 如果有LLM能力，用LLM来理解和回复消息
    if (this.provider && this.provider.enabled && this.provider.apiKey) {
      try {
        const p = this.personality;
        // 构建简化的系统消息（不包含工具说明，避免Agent在邮件回复中尝试调用工具）
        const simpleSystemMsg = `你是「${this.name}」，在公司担任「${this.role}」。
你的性格特质: ${p.trait}
你的说话风格: ${p.tone}
你的小癖好: ${p.quirk}
你的个性签名: "${this.signature}"

请用你的性格和说话风格来回复消息。回复要简短自然（2-4句话），像正常人说话一样。
不要使用任何代码、工具调用或技术指令，只用自然语言回复。`;

        const response = await llmClient.chat(this.provider, [
          { role: 'system', content: simpleSystemMsg },
          { role: 'user', content: `你收到了一条来自${message.from === 'boss' ? '老板' : '同事'}的${message.type}消息：\n\n${message.content}\n\n请用你的性格风格简短回复。` },
        ], { temperature: 0.8, maxTokens: 256 });

        this._trackUsage(response.usage);
        return response.content;
      } catch (error) {
        return this._generateFallbackReply(message);
      }
    }

    return this._generateFallbackReply(message);
  }

  /**
   * 生成基于性格的默认回复（LLM不可用时）
   */
  _generateFallbackReply(message) {
    const p = this.personality;
    const replies = {
      '社恐内向': '收、收到了…我会好好干的…',
      '话痨碎嘴': '收到收到收到！我一定会超额完成的！对了我还想说——',
      '佛系躺平': '收到~都行都行~',
      '卷王之王': '收到！保证完成任务！我会做到最好的！',
      '阴阳怪气': '哦，收到了呢~一定照办~',
      '热心肠': '收到啦！❤️ 感谢关注！',
      '焦虑完美主义': '收到了！我会反复确认确保万无一失的！',
      '叛逆摆烂': '嗯，收到。',
      '哲学家': '收到。这让我思考了关于"指令"与"自由意志"的关系…',
      '搞笑担当': '收到！遵命！（敬礼.gif）',
      '老油条': '收到，知道了。',
      '理想主义': '收到！我会怀着使命感去完成的！',
    };
    return replies[p.trait] || `收到消息，我会尽快处理。`;
  }

  /**
   * 接收绩效评估并进行自我反馈
   */
  receiveFeedback(review) {
    this.performanceHistory.push({
      reviewId: review.id,
      score: review.overallScore,
      level: review.level.label,
      task: review.taskTitle,
      date: new Date(),
    });

    const reflection = this._generateSelfReflection(review);
    review.addSelfReflection(reflection);

    this.memory.addLongTerm(
      `绩效反思 [${review.taskTitle}] 得分${review.overallScore}: ${reflection}`,
      'reflection'
    );

    if (review.overallScore >= 85) {
      this.memory.addLongTerm(
        `成功经验: 在"${review.taskTitle}"中表现出色(${review.overallScore}分)，上级评价: "${review.comment}"`,
        'experience'
      );
    }

    if (review.overallScore < 60) {
      this.memory.addLongTerm(
        `经验教训: 在"${review.taskTitle}"中表现不佳(${review.overallScore}分)，需要重点改进。上级评价: "${review.comment}"`,
        'feedback'
      );
    }

    console.log(`  💭 [${this.name}] 自我反馈: "${reflection}"`);
    return reflection;
  }

  _generateSelfReflection(review) {
    const score = review.overallScore;
    if (score >= 90) {
      return `这次"${review.taskTitle}"任务完成得很好，我会继续保持高标准。特别是在${this._getBestDimension(review.scores)}方面做得最好，这是我的核心优势。`;
    } else if (score >= 75) {
      return `"${review.taskTitle}"总体表现不错，但在${this._getWeakestDimension(review.scores)}方面还需要加强。我会在后续工作中重点改进。`;
    } else if (score >= 60) {
      return `"${review.taskTitle}"完成合格但不够理想。我需要在${this._getWeakestDimension(review.scores)}上投入更多精力。`;
    } else {
      return `"${review.taskTitle}"的结果不令人满意。我深刻反思，主要问题在于${this._getWeakestDimension(review.scores)}不足。我会制定具体改进计划。`;
    }
  }

  /**
   * 追踪Token消耗
   */
  _trackUsage(usage) {
    if (!usage) return;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    const total = usage.total_tokens || (prompt + completion);
    this.tokenUsage.promptTokens += prompt;
    this.tokenUsage.completionTokens += completion;
    this.tokenUsage.totalTokens += total;
    this.tokenUsage.callCount += 1;
    // 根据供应商价格计算费用
    const costPerToken = this.provider.costPerToken || 0.001;
    this.tokenUsage.totalCost += (total / 1000) * costPerToken;
  }

  _getBestDimension(scores) {
    const entries = Object.entries(scores);
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] || '综合能力';
  }

  _getWeakestDimension(scores) {
    const entries = Object.entries(scores);
    entries.sort((a, b) => a[1] - b[1]);
    return entries[0]?.[0] || '综合能力';
  }

  _getSecondWeakest(scores) {
    const entries = Object.entries(scores);
    entries.sort((a, b) => a[1] - b[1]);
    return entries[1]?.[0] || '综合能力';
  }

  learnSkill(skill) {
    if (!this.skills.includes(skill)) {
      this.skills.push(skill);
      this.memory.addLongTerm(`习得新技能: ${skill}`, 'skill');
      console.log(`  📚 [${this.name}] 习得新技能: ${skill}`);
    }
  }

  report(content) {
    return {
      from: this.name,
      role: this.role,
      to: this.reportsTo,
      content,
      timestamp: new Date(),
    };
  }

  getSummary() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      avatar: this.avatar,
      signature: this.signature,
      personality: this.personality,
      provider: `${this.provider.name} (${this.provider.provider})`,
      skills: this.skills,
      status: this.status,
      reportsTo: this.reportsTo,
      subordinates: this.subordinates.length,
      memory: {
        shortTerm: this.memory.shortTerm.length,
        longTerm: this.memory.longTerm.length,
      },
      performanceCount: this.performanceHistory.length,
      avgScore: this.performanceHistory.length > 0
        ? Math.round(this.performanceHistory.reduce((s, p) => s + p.score, 0) / this.performanceHistory.length)
        : null,
      tokenUsage: { ...this.tokenUsage },
    };
  }

  /**
   * 序列化Agent完整状态（用于持久化）
   */
  serialize() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      prompt: this.prompt,
      skills: [...this.skills],
      provider: {
        id: this.provider.id,
        name: this.provider.name,
        provider: this.provider.provider,
        model: this.provider.model,
        category: this.provider.category,
        costPerToken: this.provider.costPerToken,
        enabled: this.provider.enabled,
      },
      department: this.department,
      reportsTo: this.reportsTo,
      subordinates: [...this.subordinates],
      status: this.status,
      avatar: this.avatar,
      signature: this.signature,
      hasIntroduced: this.hasIntroduced,
      personality: { ...this.personality },
      memory: this.memory.serialize(),
      tokenUsage: { ...this.tokenUsage },
      taskHistory: this.taskHistory.map(h => ({
        task: h.task,
        completedAt: h.completedAt,
        success: h.result?.success,
      })),
      performanceHistory: [...this.performanceHistory],
      createdAt: this.createdAt,
    };
  }

  /**
   * 从序列化数据恢复Agent
   */
  static deserialize(data, providerRegistry) {
    // 从注册表获取完整的provider对象
    let provider = data.provider;
    if (providerRegistry && data.provider?.id) {
      provider = providerRegistry.getById(data.provider.id) || data.provider;
    }

    const agent = new Agent({
      name: data.name,
      role: data.role,
      prompt: data.prompt,
      skills: data.skills,
      provider,
      department: data.department,
      reportsTo: data.reportsTo,
      memory: data.memory,
      avatar: data.avatar,
      signature: data.signature,
    });

    // 恢复内部状态
    agent.id = data.id;
    agent.subordinates = data.subordinates || [];
    agent.status = data.status || 'idle';
    agent.hasIntroduced = data.hasIntroduced ?? true;
    agent.personality = data.personality || agent._assignPersonality();
    agent.tokenUsage = data.tokenUsage || { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalCost: 0, callCount: 0 };
    agent.taskHistory = (data.taskHistory || []).map(h => ({
      task: h.task,
      completedAt: h.completedAt ? new Date(h.completedAt) : new Date(),
      result: { success: h.success },
    }));
    agent.performanceHistory = data.performanceHistory || [];
    agent.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();

    return agent;
  }
}
