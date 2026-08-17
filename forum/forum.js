/* ═══════════════════════════════════════════════════════════
   栈知映学习论坛 · forum.js
   零依赖纯前端 SPA：数据层(localStorage) + 渲染 + 交互 + hash 路由
   功能：注册登录 · 发帖/编辑/删除 · 评论回复 · 标签分类 · 搜索
         点赞 · 收藏 · 关注 · 私信 · 通知 · 学习打卡与进度追踪
   设计参考：Stack Overflow（统计列/标签/声望）· 掘金（信息流/暗色）
             V2EX（极简节点）· 力扣打卡 · freeCodeCamp 进度激励
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 常量 ── */
  var STORE_KEY = 'stk_forum_v1';
  var SESSION_KEY = 'stk_forum_session';
  var THEME_KEY = 'stk_forum_theme';
  var NOW = Date.now();
  var H = 3600e3, D = 24 * H;

  var ICONS = {
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    message: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    trending: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
    'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
  };

  var MODULES = [
    { id: 'frontend', name: '前端开发', icon: 'code', colorA: '#4F6BF0', colorB: '#22C3E6',
      short: 'Web 前端', desc: '从 HTML/CSS/JS 三件套到 Vue/React 现代框架，构建体验出色的网页应用。',
      kmap: ['HTML5', 'CSS3', 'JavaScript', 'TypeScript', 'Vue3', 'React', '工程化', '性能优化', 'Node 基础', '浏览器原理'],
      resources: [
        { type: '官方文档', title: 'MDN Web Docs', desc: '前端最权威的参考手册，查 API、学标准的第一站。', meta: '免费 · 英文' },
        { type: '经典书籍', title: 'JavaScript 高级程序设计（第4版）', desc: '俗称「红宝书」，JS 语言核心与 DOM/BOM 全覆盖。', meta: '进阶必读' },
        { type: '视频课程', title: 'Vue3 全家桶实战', desc: '从组合式 API 到 Pinia、Vite 的完整项目实战。', meta: 'B 站可看' },
        { type: '社区资源', title: '前端面试知识图谱', desc: '社区维护的面试知识点清单，复习查漏利器。', meta: 'GitHub 开源' }
      ],
      tags: ['JavaScript', 'Vue', 'React', 'CSS', '性能优化'] },
    { id: 'algorithm', name: '算法与数据结构', icon: 'cpu', colorA: '#7C5CF0', colorB: '#F59E0B',
      short: '算法与 DS', desc: '刷题方法论、经典数据结构与算法思想，攻克笔试面试与竞赛。',
      kmap: ['数组', '链表', '栈与队列', '哈希表', '二叉树', '图论', '排序', '动态规划', '贪心', '回溯', '双指针', '滑动窗口'],
      resources: [
        { type: '刷题平台', title: 'LeetCode 力扣', desc: '算法刷题主战场，Hot 100 与每日一题。', meta: '面试必备' },
        { type: '经典书籍', title: '算法导论（CLRS）', desc: '算法理论圣经，适合深入理解复杂度与证明。', meta: '进阶必读' },
        { type: '在线教程', title: 'labuladong 的算法小抄', desc: '框架思维刷题法，背模板不如背框架。', meta: '中文友好' },
        { type: '竞赛资源', title: 'OI Wiki', desc: '竞赛向算法知识库，从入门到国集。', meta: '开源社区' }
      ],
      tags: ['动态规划', '双指针', '二叉树', '面试', '每日一题'] },
    { id: 'backend', name: '后端与数据库', icon: 'database', colorA: '#0EA5E9', colorB: '#16A34A',
      short: '后端 / DB', desc: '服务端开发、数据库设计与调优、缓存与高并发，打造可靠的系统底座。',
      kmap: ['Node.js', 'Java 生态', 'MySQL', 'Redis', 'HTTP 协议', 'REST API', '事务与锁', '索引优化', '消息队列', 'Docker', '微服务'],
      resources: [
        { type: '经典书籍', title: '高性能 MySQL（第4版）', desc: '索引、事务、调优的实战宝典。', meta: '进阶必读' },
        { type: '官方文档', title: 'Redis 官方文档', desc: '五种基础结构 + 持久化 + 集群，权威一手资料。', meta: '免费' },
        { type: '视频课程', title: '零基础 Node.js 后端实战', desc: '手写 REST API、鉴权与数据库接入。', meta: '栈知映配套' },
        { type: '设计参考', title: '系统设计入门（System Design Primer）', desc: '高并发系统设计的经典开源图谱。', meta: 'GitHub 26 万星' }
      ],
      tags: ['MySQL', 'Redis', 'Node.js', '高并发', '设计模式'] },
    { id: 'ai', name: 'AI 与机器学习', icon: 'zap', colorA: '#F59E0B', colorB: '#DC2626',
      short: 'AI / ML', desc: '机器学习基础、深度学习与大模型，从数学直觉到工程落地。',
      kmap: ['线性代数', '概率统计', '梯度下降', '神经网络', 'CNN', 'RNN', 'Transformer', 'PyTorch', 'NLP', '大模型', 'Prompt 工程', 'RAG'],
      resources: [
        { type: '视频课程', title: '吴恩达《机器学习》', desc: '公认最好的 ML 入门课，数学直觉优先。', meta: 'Coursera 免费旁听' },
        { type: '经典书籍', title: '动手学深度学习（D2L）', desc: 'PyTorch 实现为主的中文权威教材。', meta: '开源可在线读' },
        { type: '官方文档', title: 'PyTorch 官方教程', desc: '张量、自动求导到分布式训练的官方路径。', meta: '免费' },
        { type: '前沿资源', title: 'Hugging Face 课程', desc: 'Transformers 与 NLP 实战，紧跟大模型生态。', meta: '社区活跃' }
      ],
      tags: ['深度学习', 'PyTorch', 'NLP', '大模型', '入门路线'] }
  ];

  var AVATARS = [['#4F6BF0', '#22C3E6'], ['#7C5CF0', '#A78BFA'], ['#0EA5E9', '#34D399'], ['#F59E0B', '#FB7185'], ['#16A34A', '#22C3E6'], ['#DC2626', '#F59E0B']];

  /* ── 种子数据 ── */
  function seedDB() {
    var users = [
      { id: 'u1', name: '栈栈', bio: '栈知映官方君，欢迎来论坛交流学习！', role: '官方', joinedAt: NOW - 90 * D, followers: ['u2', 'u3', 'u4'], following: [], color: 0, email: 'admin@stk.cn', pass: hashPass('123456') },
      { id: 'u2', name: '算法菜鸟', bio: '大二在读，每日一题打卡中，欢迎监督。', role: '学生', joinedAt: NOW - 60 * D, followers: ['u1'], following: ['u1'], color: 1, email: 'algo@stk.cn', pass: hashPass('123456') },
      { id: 'u3', name: '后端小王子', bio: 'Java/Node 双修，正在啃高性能 MySQL。', role: '学生', joinedAt: NOW - 45 * D, followers: ['u1', 'u2'], following: ['u1', 'u4'], color: 2, email: 'backend@stk.cn', pass: hashPass('123456') },
      { id: 'u4', name: 'AI炼丹师', bio: '研一深度学习，喜欢白话讲透大模型。', role: '研究生', joinedAt: NOW - 30 * D, followers: ['u1', 'u3'], following: ['u1'], color: 3, email: 'ai@stk.cn', pass: hashPass('123456') }
    ];
    var posts = [
      { id: 'p1', authorId: 'u4', module: 'ai', title: 'Transformer 注意力机制白话讲解：Q、K、V 到底在干嘛？', tags: ['深度学习', 'NLP'],
        content: '很多人卡在注意力机制的公式上，其实用一句话就能讲明白：\n\n**注意力 = 每个词去问其它词「你跟我有多相关」，然后按相关程度把信息加权汇总。**\n\n拆开看三个矩阵：\n\n- **Q（Query）**：我当前在找什么\n- **K（Key）**：每个词能提供什么\n- **V（Value）**：每个词实际携带的内容\n\n计算流程：\n\n```python\n# 缩放点积注意力（示意）\nscores = Q @ K.T / sqrt(d_k)   # 相关性打分\nattn = softmax(scores)          # 归一化成权重\nout = attn @ V                  # 加权汇总\n```\n\n> 除以 sqrt(d_k) 是为了防止点积过大导致 softmax 饱和、梯度消失。\n\n推荐先手写一遍单头注意力再去看 Multi-Head，理解会快很多。',
        views: 328, likes: ['u1', 'u2', 'u3'], favorites: ['u2'], createdAt: NOW - 2 * H,
        comments: [
          { id: 'c1', authorId: 'u2', content: '这个解释太友好了！之前一直卡在 QKV 的物理含义。', likes: ['u4'], createdAt: NOW - 1.5 * H },
          { id: 'c2', authorId: 'u3', content: '补充：Multi-Head 就是多组 QKV 关注不同的子空间，最后拼接再投影。', likes: [], createdAt: NOW - 1 * H }
        ] },
      { id: 'p2', authorId: 'u2', module: 'algorithm', title: '力扣刷题 100 天的真实感受：从「看题解都费劲」到「周赛三题」', tags: ['面试', '每日一题'],
        content: '坚持每日一题打卡 100 天，记录几点真实感受：\n\n1. **前 30 天最痛苦**：每道题都要看题解，怀疑自己不适合学 CS\n2. **30-60 天**：开始能独立做出「似曾相识」的题\n3. **60 天之后**：套路感出现，双指针、滑动窗口、单调栈一眼识别\n\n我的方法论：\n\n- 一道题最多想 20 分钟，没思路立刻看题解\n- 看完题解**当天默写一遍**，第二天再默写一遍\n- 用错题本记录「为什么没想到」\n\n> 刷题不是拼题量，是把套路内化成肌肉记忆。\n\n欢迎大家和我一起在论坛每日打卡！',
        views: 512, likes: ['u1', 'u3', 'u4'], favorites: ['u1', 'u3'], createdAt: NOW - 5 * H,
        comments: [
          { id: 'c3', authorId: 'u4', content: '「当天默写」这个方法真的关键，很多人死在只看不写。', likes: ['u2'], createdAt: NOW - 4 * H },
          { id: 'c4', authorId: 'u1', content: '已加精！论坛侧栏有每日打卡，欢迎坚持记录。', likes: [], createdAt: NOW - 3 * H }
        ] },
      { id: 'p3', authorId: 'u3', module: 'backend', title: 'MySQL 索引失效的 8 个场景（面试高频）', tags: ['MySQL', '面试'],
        content: '索引不是建了就一定生效，以下场景会导致失效：\n\n1. 对索引列做**函数运算**（`WHERE YEAR(created_at) = 2026`）\n2. 隐式类型转换（字符串列传入数字）\n3. 前导模糊查询 `LIKE \'%xx\'`\n4. 联合索引不满足**最左前缀**\n5. OR 连接非索引列\n6. 范围查询后的列失效（联合索引中）\n7. 优化器认为全表扫描更快（小表）\n8. 负向查询 `!=`、`NOT IN` 大概率失效\n\n验证利器：\n\n```sql\nEXPLAIN SELECT * FROM orders\nWHERE user_id = 100 AND status = \'paid\';\n-- 关注 key / type / rows 三列\n```',
        views: 689, likes: ['u1', 'u2', 'u4'], favorites: ['u4'], createdAt: NOW - 9 * H,
        comments: [
          { id: 'c5', authorId: 'u2', content: '第 2 条被坑过，前端传了字符串 "100" 直接全表扫描……', likes: ['u3'], createdAt: NOW - 8 * H }
        ] },
      { id: 'p4', authorId: 'u1', module: 'frontend', title: 'CSS Grid 与 Flexbox 到底怎么选？一张表说清', tags: ['CSS'],
        content: '社区高频问题，简单总结：\n\n| 场景 | 推荐 | 理由 |\n|---|---|---|\n| 一维排列（导航栏、按钮组） | Flexbox | 主轴方向天然匹配 |\n| 二维布局（页面骨架、卡片网格） | Grid | 行列同时控制 |\n| 内容自适应换行 | Flexbox | flex-wrap 更顺手 |\n| 等分区域 / 跨行列 | Grid | fr 单位 + grid-area |\n\n记住口诀：**一维用 Flex，二维用 Grid。**\n\n```css\n/* 经典组合：外层 Grid 定骨架，内层 Flex 排内容 */\n.layout { display: grid; grid-template-columns: 240px 1fr 300px; }\n.toolbar { display: flex; align-items: center; gap: 8px; }\n```',
        views: 421, likes: ['u2', 'u3'], favorites: ['u3'], createdAt: NOW - 12 * H,
        comments: [
          { id: 'c6', authorId: 'u4', content: '补充：Grid 的 auto-fit/minmax 做响应式卡片墙也特别好用。', likes: [], createdAt: NOW - 11 * H }
        ] },
      { id: 'p5', authorId: 'u4', module: 'ai', title: '零基础入门机器学习路线（避坑版）', tags: ['入门路线', '深度学习'],
        content: '给你一条**不绕弯路**的顺序：\n\n1. **数学准备（2-3 周）**：线代（矩阵乘法、特征值直觉）+ 概率（条件概率、贝叶斯）+ 微积分（梯度）\n2. **吴恩达 ML 课程**：建立直觉，别死磕证明\n3. **手写一个线性回归 + 逻辑回归**：numpy 实现，理解损失函数与梯度下降\n4. **进入 PyTorch**：先跑通官方 60 分钟教程\n5. **做一个小项目**：MNIST 手写数字分类起步\n\n**避坑提醒**：\n\n- ❌ 一上来啃《统计学习方法》数学推导\n- ❌ 收集 100G 资料却不写一行代码\n- ✅ 每天写代码，哪怕 10 行\n\n有问题欢迎在评论区提问，我会尽量白话解答。',
        views: 356, likes: ['u1', 'u2'], favorites: ['u2'], createdAt: NOW - 20 * H,
        comments: [
          { id: 'c7', authorId: 'u2', content: '第 3 步手写回归真的有用，做完对「训练」的理解完全不一样了。', likes: ['u4'], createdAt: NOW - 18 * H }
        ] },
      { id: 'p6', authorId: 'u3', module: 'backend', title: 'Redis 缓存三兄弟：穿透、击穿、雪崩一次讲清', tags: ['Redis', '高并发'],
        content: '三个高频面试词，本质都是「缓存没兜住」：\n\n1. **穿透**：查一个不存在的数据 → 每次都打到 DB\n   - 解决：布隆过滤器 / 缓存空值（短 TTL）\n2. **击穿**：热点 key 过期瞬间，大量请求打到 DB\n   - 解决：互斥锁重建 / 逻辑过期\n3. **雪崩**：大量 key 同时过期或 Redis 宕机\n   - 解决：过期时间加随机值 / 多级缓存 / 限流降级\n\n记忆口诀：**穿不存在，击单热点，崩一大片。**',
        views: 468, likes: ['u1', 'u2', 'u4'], favorites: ['u1'], createdAt: NOW - 26 * H,
        comments: [
          { id: 'c8', authorId: 'u4', content: '口诀收了！配合实际压测数据讲会更直观。', likes: [], createdAt: NOW - 25 * H },
          { id: 'c9', authorId: 'u1', content: '逻辑过期方案细节可以再展开一期，期待。', likes: ['u3'], createdAt: NOW - 24 * H }
        ] },
      { id: 'p7', authorId: 'u2', module: 'algorithm', title: '手撕 LRU 缓存：哈希表 + 双向链表的艺术（附完整代码）', tags: ['面试', '数据结构'],
        content: 'LRU（最近最少使用）是面试手撕代码的常客。核心思路：\n\n- **哈希表**负责 O(1) 查找\n- **双向链表**负责维护访问顺序\n- 访问时把节点移到链表头，淘汰时删除链表尾\n\n```java\nclass LRUCache {\n    class Node { int key, val; Node prev, next; }\n    Map<Integer, Node> map = new HashMap<>();\n    Node head = new Node(), tail = new Node();\n    int cap;\n\n    public LRUCache(int capacity) {\n        cap = capacity;\n        head.next = tail; tail.prev = head;\n    }\n    // get / put：访问即移到头部，超出容量删尾部\n}\n```\n\n关键细节：**虚拟头尾节点**能省掉大量判空逻辑。',
        views: 598, likes: ['u1', 'u3', 'u4'], favorites: ['u3', 'u4'], createdAt: NOW - 32 * H,
        comments: [
          { id: 'c10', authorId: 'u3', content: '虚拟头尾这个 trick 每次都能让代码短一半。', likes: [], createdAt: NOW - 30 * H }
        ] },
      { id: 'p8', authorId: 'u1', module: 'frontend', title: '【公告】论坛使用指南：发帖规范与学习打卡说明', tags: ['公告'], pinned: true,
        content: '欢迎来到栈知映学习论坛！几条约定：\n\n1. **发帖**请选择对应的技能模块，并打上 1-3 个标签\n2. **提问帖**建议附上代码与报错信息，方便大家定位\n3. **学习打卡**在左侧栏「每日打卡」，连续打卡可解锁徽章\n4. **学习进度**可在「我的主页」记录每个模块的学习历程\n5. 友善交流，禁止灌水与无关广告\n\n> 论坛数据保存在浏览器本地（localStorage），清浏览器数据会重置。\n\n祝大家学习愉快！',
        views: 1520, likes: ['u2', 'u3', 'u4'], favorites: [], createdAt: NOW - 40 * H,
        comments: [
          { id: 'c11', authorId: 'u2', content: '收到！已经开始每日打卡了。', likes: [], createdAt: NOW - 38 * H }
        ] },
      { id: 'p9', authorId: 'u4', module: 'ai', title: '大模型的「幻觉」到底能不能治？聊聊 RAG 与对齐', tags: ['大模型', 'RAG'],
        content: '幻觉（Hallucination）的根源是**模型在补全概率最高的词，而不是查证事实**。\n\n目前工程界的缓解思路：\n\n1. **RAG（检索增强生成）**：把权威资料检索后拼进上下文，让模型「带着资料回答」\n2. **工具调用**：让模型调 API 查实时数据，而不是背答案\n3. **对齐（RLHF/DPO）**：让模型学会「不知道就说不知道」\n4. **输出校验**：对关键数字/引用做二次核验\n\n> 结论：幻觉无法 100% 消除，但可以通过产品设计把风险控制在可接受范围。',
        views: 275, likes: ['u1', 'u3'], favorites: ['u1'], createdAt: NOW - 50 * H,
        comments: [] },
      { id: 'p10', authorId: 'u3', module: 'backend', title: 'Node.js 零依赖实现一个 REST API 的完整心得', tags: ['Node.js', 'REST API'],
        content: '用 `node:http` 手写一个零依赖 REST 服务，几个关键点：\n\n1. **路由**：URL 解析 + 方法匹配，注意路径参数\n2. **请求体**：手动收集 chunk 再 JSON.parse，注意大小上限\n3. **JSON 响应**：统一 `Content-Type` 与状态码语义\n4. **静态文件**：注意 Range 支持（视频 seek 需要）\n5. **安全**：限流、输入清洗、路径穿越防护\n\n```js\nconst server = http.createServer(async (req, res) => {\n  const url = new URL(req.url, \'http://localhost\');\n  // 路由分发…\n});\n```\n\n手写一遍能彻底理解框架帮你做了什么。',
        views: 302, likes: ['u1', 'u2'], favorites: [], createdAt: NOW - 60 * H,
        comments: [
          { id: 'c12', authorId: 'u1', content: '和栈知映后端的实现思路完全一致，欢迎看我们的 server.js 源码交流！', likes: ['u3'], createdAt: NOW - 55 * H }
        ] },
      { id: 'p11', authorId: 'u2', module: 'algorithm', title: '递归转迭代的三种套路（附实战模板）', tags: ['数据结构'],
        content: '递归好写但容易爆栈，转迭代的三种套路：\n\n1. **显式栈模拟**：把递归调用的现场压栈\n2. **尾递归转循环**：编译器常做的优化，人也可以\n3. **状态机 / 双栈**：中序遍历的 Morris 遍历属于进阶技巧\n\n以二叉树前序遍历为例：\n\n```python\ndef preorder(root):\n    stack, res = [root], []\n    while stack:\n        node = stack.pop()\n        if node:\n            res.append(node.val)\n            stack.append(node.right)  # 先右后左，弹出顺序才正确\n            stack.append(node.left)\n    return res\n```',
        views: 233, likes: ['u3'], favorites: ['u1'], createdAt: NOW - 72 * H,
        comments: [] },
      { id: 'p12', authorId: 'u4', module: 'frontend', title: '前端性能优化清单：让首屏进入 1 秒内', tags: ['性能优化', 'JavaScript'],
        content: '按收益排序的性能优化清单：\n\n1. **资源体积**：图片 WebP/AVIF、代码压缩、tree-shaking\n2. **加载策略**：路由懒加载、首屏关键 CSS 内联、preload 关键字体\n3. **渲染**：避免布局抖动（读写分离）、虚拟列表、`content-visibility`\n4. **网络**：HTTP/2、CDN、缓存策略（immutable + hash 文件名）\n5. **运行时**：防抖节流、Web Worker 移出主线程重计算\n\n> 先量后优：Lighthouse / Performance 面板定位瓶颈，别凭感觉优化。',
        views: 267, likes: ['u2'], favorites: ['u2', 'u3'], createdAt: NOW - 80 * H,
        comments: [] }
    ];
    var progress = {
      u1: { frontend: { status: 2, percent: 90, log: [ { date: NOW - 30 * D, text: '完成 CSS Grid 布局系统学习' }, { date: NOW - 10 * D, text: '复习事件循环与微任务' } ] },
            algorithm: { status: 1, percent: 45, log: [ { date: NOW - 5 * D, text: '开始动态规划专题' } ] } },
      u2: { algorithm: { status: 1, percent: 30, log: [ { date: NOW - 3 * D, text: '完成双指针专题 20 题' } ] } }
    };
    var checkins = { u2: Array.from({ length: 8 }, function (_, i) { return dayStr(NOW - (8 - i) * D); }) };
    var notifications = [];
    var messages = [];
    return { users: users, posts: posts, progress: progress, checkins: checkins, notifications: notifications, messages: messages, seq: 1000 };
  }

  /* ── 存储层 ── */
  var DB_VERSION = 2;
  var DB;
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        // 版本不符（旧数据缺 email/pass 等字段）→ 重建种子，避免登录失效
        if (d && d.users && d.v === DB_VERSION) return d;
      }
    } catch (e) { /* 损坏则重建 */ }
    var fresh = seedDB();
    fresh.v = DB_VERSION;
    saveNow(fresh);
    return fresh;
  }
  function saveNow(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) {} }
  var saveTimer = null;
  function save() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(function () { saveNow(DB); }, 300); }

  var session = null;
  function loadSession() { try { session = localStorage.getItem(SESSION_KEY) || null; } catch (e) { session = null; } }

  /* ── 工具 ── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function uid(prefix) { return (prefix || 'n') + (++DB.seq) + '-' + Math.random().toString(36).slice(2, 7); }
  function dayStr(t) { var d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today() { return dayStr(Date.now()); }
  function fmtNum(n) { n = n || 0; return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
  function timeAgo(t) {
    var diff = Date.now() - t;
    if (diff < 60e3) return '刚刚';
    if (diff < H) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < D) return Math.floor(diff / H) + ' 小时前';
    if (diff < 30 * D) return Math.floor(diff / D) + ' 天前';
    var d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function icon(name, cls) { return '<span data-icon="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + '></span>'; }
  function injectIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      var n = el.getAttribute('data-icon');
      if (ICONS[n]) el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICONS[n] + '</svg>';
    });
  }
  function userById(id) { return DB.users.find(function (u) { return u.id === id; }); }
  function me() { return session ? userById(session) : null; }
  function avatarHtml(u, cls) {
    if (!u) return '';
    var c = AVATARS[u.color || 0];
    return '<span class="avatar ' + (cls || '') + '" style="--avatar-a:' + c[0] + ';--avatar-b:' + c[1] + '" aria-hidden="true">' + esc(u.name.charAt(0)) + '</span>';
  }
  function renderMd(text) {
    if (typeof window.renderMarkdown === 'function') return window.renderMarkdown(text);
    return '<p class="md-paragraph">' + esc(text).replace(/\n/g, '<br>') + '</p>';
  }
  function toast(msg) {
    var root = $('toast-root');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 2200);
  }
  function moduleById(id) { return MODULES.find(function (m) { return m.id === id; }); }
  function postById(id) { return DB.posts.find(function (p) { return p.id === id; }); }
  function userPosts(uid) { return DB.posts.filter(function (p) { return p.authorId === uid; }); }
  function postsOfModule(mid) { return DB.posts.filter(function (p) { return p.module === mid; }); }
  function postComments(p) { return p.comments || []; }
  function userLikesReceived(uid) {
    var n = 0;
    DB.posts.forEach(function (p) { n += (p.likes || []).filter(function (x) { return x !== uid; }).length; (p.comments || []).forEach(function (c) { n += (c.likes || []).filter(function (x) { return x !== uid; }).length; }); });
    return n;
  }
  function notifCount() { return me() ? DB.notifications.filter(function (n) { return n.userId === me().id && !n.read; }).length : 0; }
  function unreadMsgs(uid) {
    return DB.messages.filter(function (m) { return m.to === uid && !m.read; }).length;
  }
  function convPeers(uid) {
    var map = {};
    DB.messages.forEach(function (m) {
      if (m.from === uid || m.to === uid) {
        var peer = m.from === uid ? m.to : m.from;
        if (!map[peer]) map[peer] = [];
        map[peer].push(m);
      }
    });
    return Object.keys(map).map(function (k) { return { peerId: k, msgs: map[k].sort(function (a, b) { return a.at - b.at; }) }; })
      .sort(function (a, b) { return b.msgs[b.msgs.length - 1].at - a.msgs[a.msgs.length - 1].at; });
  }
  function streakDays(uid) {
    var days = (DB.checkins[uid] || []).slice().sort();
    if (!days.length) return 0;
    var n = 0; var cur = new Date();
    if (days[days.length - 1] !== today() && days[days.length - 1] !== dayStr(Date.now() - D)) return 0;
    var cursor = new Date(days[days.length - 1]);
    for (var i = days.length - 1; i >= 0; i--) {
      if (dayStr(cursor.getTime()) === days[i]) { n++; cursor.setDate(cursor.getDate() - 1); } else break;
    }
    return n;
  }
  function addNotif(userId, type, actorId, postId, text) {
    DB.notifications.unshift({ id: uid('ntf'), userId: userId, type: type, actorId: actorId, postId: postId || null, text: text, read: false, createdAt: Date.now() });
    save();
  }

  /* ── 徽章 ── */
  var MEDALS = [
    { id: 'first-post', icon: 'edit', color: 'linear-gradient(135deg,#4F6BF0,#22C3E6)', name: '初入论坛', desc: '发布第一篇帖子', check: function (u) { return userPosts(u.id).length >= 1; } },
    { id: 'prolific', icon: 'book', color: 'linear-gradient(135deg,#7C5CF0,#A78BFA)', name: '小有所成', desc: '发布 5 篇帖子', check: function (u) { return userPosts(u.id).length >= 5; } },
    { id: 'liked', icon: 'heart', color: 'linear-gradient(135deg,#F59E0B,#FB7185)', name: '点赞收割机', desc: '获得 20 个赞', check: function (u) { return userLikesReceived(u.id) >= 20; } },
    { id: 'streak', icon: 'flame', color: 'linear-gradient(135deg,#DC2626,#F59E0B)', name: '持之以恒', desc: '连续打卡 7 天', check: function (u) { return streakDays(u.id) >= 7; } },
    { id: 'scholar', icon: 'award', color: 'linear-gradient(135deg,#F59E0B,#16A34A)', name: '满级学霸', desc: '四大模块总进度 ≥ 300%', check: function (u) { return totalPercent(u.id) >= 300; } },
    { id: 'social', icon: 'users', color: 'linear-gradient(135deg,#0EA5E9,#34D399)', name: '社交达人', desc: '获得 3 个关注者', check: function (u) { return (u.followers || []).length >= 3; } }
  ];
  function totalPercent(uid) {
    var p = DB.progress[uid] || {};
    return MODULES.reduce(function (s, m) { return s + ((p[m.id] && p[m.id].percent) || 0); }, 0);
  }

  /* ── 顶栏 ── */
  function renderTopbar() {
    var box = $('tbUser');
    var u = me();
    if (!u) {
      box.innerHTML = '<div class="tb-auth"><button class="btn btn-sm" data-action="auth" data-mode="login">登录</button><button class="btn btn-primary btn-sm" data-action="auth" data-mode="register">注册</button></div>';
    } else {
      box.innerHTML = '<div class="dropdown">' +
        '<button class="tb-btn" id="userMenuBtn" aria-haspopup="true" aria-expanded="false">' + avatarHtml(u) + '<span data-icon="chevron-down" style="width:14px;height:14px"></span></button>' +
        '<div class="dropdown-menu" id="userMenu" hidden>' +
          '<div style="padding:8px 11px;font-size:13px"><b>' + esc(u.name) + '</b><div class="muted">' + esc(u.role || '学生') + '</div></div><hr>' +
          '<a href="#/me">' + icon('user') + '个人主页与进度</a>' +
          '<a href="#/notifications">' + icon('bell') + '通知中心</a>' +
          '<button data-action="toggle-theme">' + icon('sun') + '切换主题</button><hr>' +
          '<button data-action="logout">' + icon('log-out') + '退出登录</button>' +
        '</div></div>';
    }
    injectIcons(box);
    $('notifBadge').hidden = notifCount() === 0;
    $('notifBadge').textContent = notifCount() > 99 ? '99+' : notifCount();
  }

  /* ── 侧栏 ── */
  function renderSidebar() {
    var counts = {};
    MODULES.forEach(function (m) { counts[m.id] = postsOfModule(m.id).length; });
    var u = me();
    var mine = u ? userPosts(u.id).length : 0;
    var favs = u ? DB.posts.filter(function (p) { return (p.favorites || []).indexOf(u.id) >= 0; }).length : 0;
    var streak = u ? streakDays(u.id) : 0;
    var checkedToday = u && (DB.checkins[u.id] || []).indexOf(today()) >= 0;

    $('sidebar').innerHTML =
      '<div class="nav-group"><div class="nav-title">浏览</div>' +
        '<a class="nav-item" href="#/" data-nav="home">' + icon('home') + '首页</a>' +
        '<a class="nav-item" href="#/all" data-nav="all">' + icon('search') + '全部帖子</a>' +
      '</div>' +
      '<div class="nav-group"><div class="nav-title">技能模块</div>' +
        MODULES.map(function (m) {
          return '<a class="nav-item" href="#/module/' + m.id + '" data-nav="module-' + m.id + '">' + icon(m.icon) + esc(m.short) + '<span class="nav-count">' + counts[m.id] + '</span></a>';
        }).join('') +
      '</div>' +
      '<div class="nav-group"><div class="nav-title">我的</div>' +
        '<a class="nav-item" href="#/me" data-nav="me">' + icon('user') + '个人主页<span class="nav-count">' + mine + '</span></a>' +
        '<a class="nav-item" href="#/search?q=&fav=1" data-nav="favs">' + icon('bookmark') + '我的收藏<span class="nav-count">' + favs + '</span></a>' +
        '<a class="nav-item" href="#/notifications" data-nav="notif">' + icon('bell') + '通知中心</a>' +
      '</div>' +
      '<div class="checkin-card"><h3>' + icon('flame') + '每日学习打卡</h3>' +
        '<p>连续打卡可解锁「持之以恒」徽章</p>' +
        '<div class="checkin-stats"><div><b>' + streak + '</b><span>连续天数</span></div><div><b>' + totalPercent(me() ? me().id : '') + '%</b><span>总进度</span></div></div>' +
        '<button class="checkin-btn' + (checkedToday ? ' done' : '') + '" data-action="checkin">' + (checkedToday ? '今日已打卡 ✓' : '立即打卡') + '</button>' +
      '</div>';
    injectIcons($('sidebar'));
  }

  /* ── 右侧栏 ── */
  function renderRail() {
    var hot = DB.posts.slice().sort(function (a, b) { return ((b.likes || []).length + (b.comments || []).length) - ((a.likes || []).length + (a.comments || []).length); }).slice(0, 5);
    var u = me();
    var rec = DB.users.filter(function (x) { return x.id !== (u && u.id); })
      .sort(function (a, b) { return (b.followers || []).length - (a.followers || []).length; }).slice(0, 3);
    var tagCount = {};
    DB.posts.forEach(function (p) { (p.tags || []).forEach(function (t) { tagCount[t] = (tagCount[t] || 0) + 1; }); });
    var hotTags = Object.keys(tagCount).sort(function (a, b) { return tagCount[b] - tagCount[a]; }).slice(0, 8);

    $('rail').innerHTML =
      '<div class="rail-card"><h3>' + icon('trending') + '热门话题</h3>' +
        hot.map(function (p, i) {
          return '<a class="hot-item" href="#/post/' + p.id + '"><span class="rank">' + (i + 1) + '</span><span class="h-title">' + esc(p.title) + '</span><span class="h-count">' + icon('heart') + fmtNum((p.likes || []).length) + '</span></a>';
        }).join('') +
      '</div>' +
      '<div class="rail-card"><h3>' + icon('hash') + '热门标签</h3><div class="tag-line">' +
        hotTags.map(function (t) { return '<a class="tag" href="#/search?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join('') +
      '</div></div>' +
      '<div class="rail-card"><h3>' + icon('users') + '推荐关注</h3>' +
        rec.map(function (x) {
          var f = u && (u.following || []).indexOf(x.id) >= 0;
          return '<div class="user-row">' + avatarHtml(x, 'avatar-md') + '<a class="u-info" href="#/user/' + x.id + '"><span class="u-name">' + esc(x.name) + '</span><span class="u-desc">' + esc(x.role || '') + ' · ' + fmtNum((x.followers || []).length) + ' 关注者</span></a>' +
            (u && x.id !== u.id ? '<button class="btn btn-sm follow-mini' + (f ? ' following' : '') + '" data-action="follow" data-id="' + x.id + '">' + (f ? '已关注' : '+ 关注') + '</button>' : '') +
          '</div>';
        }).join('') +
      '</div>';
    injectIcons($('rail'));
  }

  /* ── 帖子卡片 ── */
  function postCard(p) {
    var author = userById(p.authorId);
    return '<article class="post-card' + (p.pinned ? ' pinned' : '') + '" data-action="open-post" data-id="' + p.id + '">' +
      '<div class="post-stats"><div><b>' + fmtNum((p.likes || []).length) + '</b><div>点赞</div></div>' +
      '<div class="stat-likes"><b>' + fmtNum((p.comments || []).length) + '</b><div>评论</div></div>' +
      '<div><b>' + fmtNum(p.views || 0) + '</b><div>浏览</div></div></div>' +
      '<div class="post-main">' +
        '<h2 class="post-title">' + (p.pinned ? '<span class="pill pin-pill">' + icon('star') + '置顶</span> ' : '') + esc(p.title) + '</h2>' +
        '<p class="post-excerpt">' + esc((p.content || '').replace(/```[\s\S]*?```/g, ' [代码] ').replace(/[#>*`|]/g, '').slice(0, 120)) + '</p>' +
        '<div class="post-meta">' +
          '<span class="pill">' + icon(moduleById(p.module).icon) + esc(moduleById(p.module).short) + '</span>' +
          '<span class="tag-line">' + (p.tags || []).slice(0, 3).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</span>' +
          '<span class="post-author">' + avatarHtml(author) + '<a class="name" href="#/user/' + author.id + '" data-action="noop">' + esc(author.name) + '</a>· <time>' + timeAgo(p.createdAt) + '</time></span>' +
        '</div>' +
      '</div></article>';
  }

  /* ── 首页 / 列表 ── */
  var feedState = { view: 'home', tab: 'hot', query: null, favOnly: false, moduleFilter: null };
  function moduleFilterBar() {
    var counts = {};
    MODULES.forEach(function (m) { counts[m.id] = postsOfModule(m.id).length; });
    return '<div class="module-tabs" role="tablist" aria-label="按模块筛选">' +
      '<button class="module-tab' + (!feedState.moduleFilter ? ' active' : '') + '" data-action="module-filter" data-mid="">全部 ' + DB.posts.length + '</button>' +
      MODULES.map(function (m) {
        return '<button class="module-tab' + (feedState.moduleFilter === m.id ? ' active' : '') + '" data-action="module-filter" data-mid="' + m.id + '">' + esc(m.short) + ' ' + counts[m.id] + '</button>';
      }).join('') + '</div>';
  }
  function renderFeed() {
    var q = feedState.query, fav = feedState.favOnly, u = me();
    var isHome = feedState.view === 'home';
    var list = DB.posts.slice();
    if (fav) list = list.filter(function (p) { return u && (p.favorites || []).indexOf(u.id) >= 0; });
    else if (feedState.moduleFilter) list = list.filter(function (p) { return p.module === feedState.moduleFilter; });
    if (q) {
      var kw = q.toLowerCase();
      list = list.filter(function (p) {
        return p.title.toLowerCase().indexOf(kw) >= 0 || (p.content || '').toLowerCase().indexOf(kw) >= 0 ||
          (p.tags || []).some(function (t) { return t.toLowerCase().indexOf(kw) >= 0; });
      });
    }
    // 首页：置顶帖单独提为「今日推荐」
    var pinned = [];
    if (isHome && !q && !fav && !feedState.moduleFilter) {
      pinned = list.filter(function (p) { return p.pinned; });
      list = list.filter(function (p) { return !p.pinned; });
    }
    if (feedState.tab === 'hot') list.sort(function (a, b) { return ((b.likes || []).length + (b.comments || []).length * 2) - ((a.likes || []).length + (a.comments || []).length * 2); });
    else list.sort(function (a, b) { return b.createdAt - a.createdAt; });

    var head = '';
    if (q) {
      head = '<div class="back-row"><a class="back-link" href="#/">' + icon('arrow-left') + '返回首页</a></div>' +
        '<div class="section-title">' + icon('search') + '搜索「' + esc(q) + '」' + (fav ? '（我的收藏）' : '') + '<span class="muted"> · 共 ' + list.length + ' 条结果</span></div>';
    } else if (fav) {
      head = '<div class="section-title">' + icon('bookmark') + '我的收藏<span class="muted"> · ' + list.length + ' 篇</span></div>';
    } else if (isHome) {
      head = '<div class="feed-toolbar">' +
        '<div class="feed-tabs"><button class="feed-tab' + (feedState.tab === 'latest' ? ' active' : '') + '" data-action="feed-tab" data-tab="latest">最新</button>' +
        '<button class="feed-tab' + (feedState.tab === 'hot' ? ' active' : '') + '" data-action="feed-tab" data-tab="hot">热门</button></div>' +
        '<div class="grow"></div>' +
        '<button class="btn btn-primary" data-action="compose">' + icon('edit') + '发布新帖</button>' +
      '</div>';
    } else {
      // 全部帖子：模块筛选栏 + 排序切换
      head = '<div class="feed-toolbar">' + moduleFilterBar() + '<div class="grow"></div>' +
        '<div class="feed-tabs"><button class="feed-tab' + (feedState.tab === 'latest' ? ' active' : '') + '" data-action="feed-tab" data-tab="latest">最新</button>' +
        '<button class="feed-tab' + (feedState.tab === 'hot' ? ' active' : '') + '" data-action="feed-tab" data-tab="hot">热门</button></div>' +
        '<button class="btn btn-primary" data-action="compose">' + icon('edit') + '发布新帖</button></div>';
    }
    var body = '';
    if (fav && !u) {
      body = '<div class="empty">' + icon('bookmark') + '<h3>请先登录</h3><p>登录后即可查看你的收藏</p><p style="margin-top:10px"><button class="btn btn-primary" data-action="auth" data-mode="login">立即登录</button></p></div>';
    } else {
      body = list.length
        ? list.map(postCard).join('')
        : '<div class="empty">' + icon('inbox') + '<h3>暂无内容</h3><p>' + (q ? '换个关键词试试' : '来发布第一篇帖子吧') + '</p></div>';
    }
    var pinnedHtml = pinned.length
      ? '<div class="section-title">' + icon('star') + '今日推荐</div>' + pinned.map(postCard).join('')
      : '';
    $('feed').innerHTML = head + pinnedHtml + body;
    injectIcons($('feed'));
  }

  /* ── 模块页 ── */
  var moduleTab = 'intro';
  function renderModule(mid) {
    var m = moduleById(mid);
    if (!m) { location.hash = '#/'; return; }
    var list = postsOfModule(mid).sort(function (a, b) { return b.createdAt - a.createdAt; });
    var u = me();
    var p = u && DB.progress[u.id] && DB.progress[u.id][mid];
    var intro = '<div class="module-hero">' +
      '<div class="mh-top"><div class="mh-icon" style="background:linear-gradient(135deg,' + m.colorA + ',' + m.colorB + ')">' + icon(m.icon) + '</div>' +
      '<div><h1>' + esc(m.name) + '</h1><div class="mh-sub">' + list.length + ' 个讨论 · ' + (m.resources || []).length + ' 个推荐资源</div></div></div>' +
      '<p>' + esc(m.desc) + '</p>' +
      '<div class="mh-stats"><div><b>' + list.length + '</b><span>讨论帖</span></div><div><b>' + (m.kmap || []).length + '</b><span>知识点</span></div><div><b>' + (p ? p.percent : 0) + '%</b><span>我的进度</span></div><div><b>' + (m.resources || []).length + '</b><span>学习资源</span></div></div>' +
    '</div>';
    var tabs = '<div class="module-tabs">' +
      ['intro', 'resources', 'discuss', 'progress'].map(function (t) {
        var label = { intro: '技能介绍', resources: '学习资源', discuss: '相关讨论', progress: '我的进度' }[t];
        return '<button class="module-tab' + (moduleTab === t ? ' active' : '') + '" data-action="module-tab" data-mid="' + m.id + '" data-tab="' + t + '">' + label + '</button>';
      }).join('') + '</div>';

    var body = '';
    if (moduleTab === 'intro') {
      body = '<div class="panel-clean" style="background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:20px;box-shadow:var(--sh-1)">' +
        '<div class="section-title">' + icon('grid') + '知识图谱</div><p class="muted" style="margin-bottom:12px">该模块覆盖的核心知识点，点击话题即可搜索相关讨论</p>' +
        '<div class="kmap">' + (m.kmap || []).map(function (k) { return '<a class="kitem" href="#/search?q=' + encodeURIComponent(k) + '">' + esc(k) + '<b>→</b></a>'; }).join('') + '</div>' +
      '</div>';
    } else if (moduleTab === 'resources') {
      body = '<div class="res-grid">' + (m.resources || []).map(function (r) {
        return '<div class="res-card"><span class="rc-type">' + esc(r.type) + '</span><h3>' + esc(r.title) + '</h3><p>' + esc(r.desc) + '</p><div class="rc-meta"><span>' + esc(r.meta) + '</span><span class="rc-link">' + icon('book') + '学习资源</span></div></div>';
      }).join('') + '</div>';
    } else if (moduleTab === 'discuss') {
      body = '<div class="feed-toolbar" style="margin-bottom:2px"><div class="section-title">' + icon('message') + '相关讨论（' + list.length + '）</div><div class="grow"></div><button class="btn btn-primary btn-sm" data-action="compose" data-mid="' + m.id + '">' + icon('plus') + '发帖</button></div>' +
        (list.length ? list.map(postCard).join('') : '<div class="empty">' + icon('inbox') + '<h3>还没有讨论</h3><p>发布第一篇讨论吧</p></div>');
    } else if (moduleTab === 'progress') {
      body = renderProgressPanel(mid);
    }
    $('feed').innerHTML = intro + tabs + body;
    injectIcons($('feed'));
  }

  function renderProgressPanel(mid) {
    var u = me();
    if (!u) return '<div class="empty">' + icon('user') + '<h3>请先登录</h3><p>登录后即可记录学习进度</p><p style="margin-top:10px"><button class="btn btn-primary" data-action="auth" data-mode="login">立即登录</button></p></div>';
    var p = DB.progress[u.id] || {};
    var cur = p[mid] || { status: 0, percent: 0, log: [] };
    var m = moduleById(mid);
    var statusBtns = '<div class="p-status">' +
      ['未开始', '学习中', '已掌握'].map(function (label, i) {
        var cls = cur.status === i ? (i === 2 ? 'on-done' : 'on-doing') : '';
        return '<button class="' + cls + '" data-action="set-status" data-mid="' + mid + '" data-status="' + i + '">' + label + '</button>';
      }).join('') + '</div>';
    var logHtml = (cur.log || []).slice().reverse().map(function (l, i) {
      return '<div class="tl-item' + (i === 0 && cur.status === 2 ? ' done' : '') + '"><div class="tl-date">' + esc(l.date) + '</div><div class="tl-text">' + esc(l.text) + '</div></div>';
    }).join('') || '<p class="muted">还没有记录，写下第一条学习历程吧。</p>';

    return '<div class="progress-card">' +
      '<h3>' + icon('target') + esc(m.name) + ' · 学习进度</h3>' +
      '<div class="p-row"><span class="p-name">模块掌握度</span><div class="progress-bar"><i style="width:' + cur.percent + '%"></i></div><span class="p-val">' + cur.percent + '%</span></div>' +
      '<div class="p-row" style="align-items:center"><span class="p-name">学习状态</span>' + statusBtns + '</div>' +
      '<div class="p-row" style="align-items:center"><span class="p-name">调整进度</span>' +
        '<input type="range" min="0" max="100" step="5" value="' + cur.percent + '" style="flex:1" aria-label="调整模块进度" data-action="set-percent" data-mid="' + mid + '">' +
        '<span class="p-val" id="percentVal">' + cur.percent + '%</span></div>' +
      '<div style="margin-top:16px"><div class="section-title" style="font-size:13.5px">' + icon('clock') + '学习历程</div></div>' +
      '<div class="timeline" style="margin-top:14px">' + logHtml + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:16px;align-items:flex-start">' +
        '<textarea id="logInput" style="flex:1;min-height:56px;resize:vertical;padding:10px 13px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg-soft);font-size:13px;line-height:1.7;outline:none" placeholder="记录今天学了什么，例如：完成了快排的三种实现"></textarea>' +
        '<button class="btn btn-primary" data-action="add-log" data-mid="' + mid + '" style="height:42px">' + icon('plus') + '记录</button>' +
      '</div>' +
    '</div>';
  }

  /* ── 帖子详情 ── */
  function renderPost(id) {
    var p = postById(id);
    if (!p) { location.hash = '#/'; return; }
    p.views = (p.views || 0) + 1; save();
    var author = userById(p.authorId);
    var u = me();
    var liked = u && (p.likes || []).indexOf(u.id) >= 0;
    var faved = u && (p.favorites || []).indexOf(u.id) >= 0;
    var following = u && (u.following || []).indexOf(author.id) >= 0;
    var isMine = u && u.id === author.id;

    var related = DB.posts.filter(function (x) { return x.module === p.module && x.id !== p.id; })
      .sort(function (a, b) { return (b.likes || []).length - (a.likes || []).length; }).slice(0, 3);

    var commentsHtml = (p.comments || []).map(function (c) {
      var ca = userById(c.authorId);
      var cLiked = u && (c.likes || []).indexOf(u.id) >= 0;
      return '<div class="comment">' + avatarHtml(ca) +
        '<div class="comment-main">' +
          '<div class="comment-head"><a href="#/user/' + ca.id + '"><b>' + esc(ca.name) + '</b></a><span class="muted">' + timeAgo(c.createdAt) + '</span>' +
          (c.replyTo ? '<span class="muted">回复 @' + esc(c.replyTo) + '</span>' : '') + '</div>' +
          '<div class="comment-body md-body">' + renderMd(c.content) + '</div>' +
          '<div class="comment-foot">' +
            '<button class="' + (cLiked ? 'liked' : '') + '" data-action="like-comment" data-post="' + p.id + '" data-comment="' + c.id + '">' + icon('heart') + '赞 ' + (c.likes || []).length + '</button>' +
            '<button data-action="reply-comment" data-post="' + p.id + '" data-comment="' + c.id + '" data-name="' + esc(ca.name) + '">' + icon('message') + '回复</button>' +
          '</div>' +
        '</div></div>';
    }).join('') || '<div class="empty" style="padding:32px">' + icon('message') + '<h3>还没有评论</h3><p>抢个沙发吧</p></div>';

    $('feed').innerHTML =
      '<div class="back-row"><a class="back-link" href="#/module/' + p.module + '/discuss">' + icon('arrow-left') + '返回「' + esc(moduleById(p.module).name) + '」</a></div>' +
      '<article class="post-detail">' +
        '<h1>' + esc(p.title) + '</h1>' +
        '<div class="pd-meta">' +
          '<span class="pd-author">' + avatarHtml(author, 'avatar-md') + '<div><a href="#/user/' + author.id + '"><b>' + esc(author.name) + '</b></a>' +
          (u && author.id !== u.id ? '<button class="btn btn-sm btn-follow' + (following ? ' following' : '') + '" data-action="follow" data-id="' + author.id + '">' + (following ? '已关注' : '+ 关注') + '</button>' : '') +
          '</div></span>' +
          '<span class="sep">·</span><span>' + icon('clock') + ' ' + timeAgo(p.createdAt) + '</span>' +
          '<span class="sep">·</span><span>' + icon('eye') + ' ' + fmtNum(p.views) + ' 浏览</span>' +
          '<span class="tag-line">' + (p.tags || []).map(function (t) { return '<a class="tag" href="#/search?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join('') + '</span>' +
        '</div>' +
        '<div class="post-body md-body">' + renderMd(p.content) + '</div>' +
        '<div class="pd-actions">' +
          '<button class="action-btn' + (liked ? ' on' : '') + '" data-action="like-post" data-id="' + p.id + '">' + icon('heart') + (liked ? '已点赞' : '点赞') + ' <b style="font-family:var(--mono)">' + (p.likes || []).length + '</b></button>' +
          '<button class="action-btn' + (faved ? ' on-fav' : '') + '" data-action="fav-post" data-id="' + p.id + '">' + icon('bookmark') + (faved ? '已收藏' : '收藏') + '</button>' +
          (isMine ? '<button class="action-btn" data-action="edit-post" data-id="' + p.id + '">' + icon('edit') + '编辑</button>' +
                    '<button class="action-btn" data-action="delete-post" data-id="' + p.id + '" style="color:var(--danger)">' + icon('trash') + '删除</button>' : '') +
        '</div>' +
      '</article>' +
      '<section class="comments" aria-label="评论区">' +
        '<div class="comments-head">' + icon('message') + '评论 ' + (p.comments || []).length + '</div>' +
        commentsHtml +
        '<div class="comment-box">' + (u ? avatarHtml(u) : '<span class="avatar" style="--avatar-a:#94A3B8;--avatar-b:#CBD5E1">?</span>') +
          '<textarea id="commentInput" placeholder="友善发言，写下你的看法…（支持 Markdown）" aria-label="发表评论"></textarea>' +
          '<button class="btn btn-primary" data-action="add-comment" data-id="' + p.id + '" style="height:44px">' + icon('send') + '评论</button>' +
        '</div>' +
      '</section>' +
      (related.length ? '<div class="rail-card rail-mobile"><h3>' + icon('trending') + '相关推荐</h3>' +
        related.map(function (r) { return '<a class="hot-item" href="#/post/' + r.id + '"><span class="rank">·</span><span class="h-title">' + esc(r.title) + '</span><span class="h-count">' + icon('heart') + fmtNum((r.likes || []).length) + '</span></a>'; }).join('') + '</div>' : '');
    injectIcons($('feed'));
    var ci = $('commentInput');
    if (ci) ci.focus();
  }

  /* ── 用户主页 ── */
  function renderUser(id) {
    var u = userById(id);
    if (!u) { location.hash = '#/'; return; }
    var meU = me();
    var following = meU && (meU.following || []).indexOf(u.id) >= 0;
    var isMe = meU && meU.id === u.id;
    var posts = userPosts(u.id).sort(function (a, b) { return b.createdAt - a.createdAt; });
    var likesGot = userLikesReceived(u.id);
    var streak = streakDays(u.id);
    var p = DB.progress[u.id] || {};

    var medals = MEDALS.map(function (m) {
      var on = m.check(u);
      return '<div class="medal' + (on ? '' : ' locked') + '"><span class="m-icon" style="background:' + m.color + '">' + icon(m.icon) + '</span><div><h4>' + m.name + '</h4><p>' + m.desc + (on ? ' · 已获得' : ' · 未解锁') + '</p></div></div>';
    }).join('');

    var progressRows = MODULES.map(function (m) {
      var cur = p[m.id] || { status: 0, percent: 0 };
      var label = ['未开始', '学习中', '已掌握'][cur.status];
      return '<div class="p-row"><span class="p-name">' + esc(m.short) + '</span><div class="progress-bar"><i style="width:' + cur.percent + '%"></i></div><span class="p-val">' + label + '</span></div>';
    }).join('');

    var logAll = [];
    MODULES.forEach(function (m) { (p[m.id] && p[m.id].log || []).forEach(function (l) { logAll.push({ date: l.date, text: l.text }); }); });
    logAll.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    $('feed').innerHTML =
      '<div class="back-row"><a class="back-link" href="#/">' + icon('arrow-left') + '返回首页</a></div>' +
      '<div class="profile-head"><div class="ph-cover"></div><div class="ph-body"><div class="ph-main">' +
        avatarHtml(u, 'avatar-lg') +
        '<div><div class="ph-name">' + esc(u.name) + '<span class="ph-role">' + esc(u.role || '学生') + '</span></div>' +
        '<div class="muted" style="margin-top:2px">' + esc(u.bio || '这个人很低调，什么都没写。') + '</div>' +
        '<div class="ph-stats" style="margin-top:10px">' +
          '<div><b>' + posts.length + '</b><span>发帖</span></div><div><b>' + fmtNum(likesGot) + '</b><span>获赞</span></div>' +
          '<div><b>' + fmtNum((u.followers || []).length) + '</b><span>关注者</span></div><div><b>' + streak + '</b><span>连续打卡</span></div>' +
          '<div><b>' + totalPercent(u.id) + '%</b><span>总进度</span></div>' +
        '</div></div>' +
        (isMe ? '<div class="ph-actions"><a class="btn btn-primary btn-sm" href="#/me">' + icon('edit') + '管理进度</a></div>'
              : (meU ? '<div class="ph-actions"><button class="btn btn-primary btn-sm" data-action="follow" data-id="' + u.id + '">' + (following ? '已关注' : '+ 关注') + '</button><button class="btn btn-sm" data-action="dm" data-id="' + u.id + '">' + icon('send') + '私信</button></div>' : '')) +
      '</div></div></div>' +
      '<div class="progress-card"><h3>' + icon('activity') + '学习进度</h3>' + progressRows + '</div>' +
      '<div class="progress-card"><h3>' + icon('award') + '徽章墙</h3><div class="badge-wall">' + medals + '</div></div>' +
      '<div class="progress-card"><h3>' + icon('clock') + '学习历程</h3>' +
        (logAll.length ? '<div class="timeline" style="margin-top:6px">' + logAll.slice(0, 10).map(function (l) {
          return '<div class="tl-item"><div class="tl-date">' + esc(l.date) + '</div><div class="tl-text">' + esc(l.text) + '</div></div>';
        }).join('') + '</div>' : '<p class="muted">还没有学习记录。</p>') +
      '</div>' +
      '<div class="progress-card"><h3>' + icon('edit') + 'TA 的帖子（' + posts.length + '）</h3><div style="margin-top:12px;display:flex;flex-direction:column;gap:12px">' +
        (posts.length ? posts.slice(0, 10).map(postCard).join('') : '<p class="muted">暂无帖子。</p>') + '</div></div>';
    injectIcons($('feed'));
  }

  /* ── 私信 ── */
  var dmPeer = null;
  function renderMessages(peerId) {
    var u = me();
    if (!u) { location.hash = '#/'; return; }
    if (peerId) dmPeer = peerId;
    var convs = convPeers(u.id);
    if (dmPeer && !convs.some(function (c) { return c.peerId === dmPeer; })) dmPeer = null;
    var active = convs.find(function (c) { return c.peerId === dmPeer; }) || convs[0] || null;
    if (active) dmPeer = active.peerId;

    var listHtml = convs.length ? convs.map(function (c) {
      var peer = userById(c.peerId);
      var last = c.msgs[c.msgs.length - 1];
      var unread = c.msgs.filter(function (m) { return m.to === u.id && !m.read; }).length;
      return '<button class="conv-item' + (active && active.peerId === c.peerId ? ' active' : '') + '" data-action="open-dm" data-id="' + c.peerId + '">' +
        avatarHtml(peer) + '<span class="ci-main"><span class="ci-top"><b>' + esc(peer.name) + '</b><time>' + timeAgo(last.at) + '</time></span>' +
        '<span class="ci-last">' + (last.from === u.id ? '我：' : '') + esc(last.text) + '</span></span>' +
        (unread ? '<span class="ci-unread"></span>' : '') + '</button>';
    }).join('') : '<div class="empty" style="padding:30px"><p>还没有私信</p></div>';

    var chatHtml = '';
    if (active) {
      var peer = userById(active.peerId);
      chatHtml = '<div class="chat-head">' + avatarHtml(peer) + '<span>' + esc(peer.name) + '</span><span class="muted">' + esc(peer.role || '') + '</span></div>' +
        '<div class="chat-msgs" id="chatMsgs">' + active.msgs.map(function (m) {
          return '<div class="msg ' + (m.from === u.id ? 'mine' : 'theirs') + '">' + esc(m.text) + '<time>' + timeAgo(m.at) + '</time></div>';
        }).join('') + '</div>' +
        '<div class="chat-input"><textarea id="dmInput" placeholder="发消息…（Enter 发送，Shift+Enter 换行）" aria-label="私信内容"></textarea>' +
        '<button class="btn btn-primary" data-action="send-dm" data-id="' + active.peerId + '" aria-label="发送">' + icon('send') + '</button></div>';
    } else {
      chatHtml = '<div class="empty" style="margin:auto">' + icon('message') + '<h3>选择一位同学开始聊天</h3><p>可以去他的主页点「私信」发起会话</p></div>';
    }

    $('feed').innerHTML =
      '<div class="back-row"><a class="back-link" href="#/">' + icon('arrow-left') + '返回首页</a></div>' +
      '<div class="section-title">' + icon('message') + '私信</div>' +
      '<div class="two-col"><div class="conv-list" role="tablist" aria-label="会话列表">' + listHtml + '</div><div class="chat-panel">' + chatHtml + '</div></div>';
    injectIcons($('feed'));
    // 标记当前会话已读
    if (active) {
      var changed = false;
      DB.messages.forEach(function (m) { if (m.to === u.id && m.from === active.peerId && !m.read) { m.read = true; changed = true; } });
      if (changed) { save(); renderTopbar(); }
      var box = $('chatMsgs'); if (box) box.scrollTop = box.scrollHeight;
    }
  }

  /* ── 通知 ── */
  function renderNotifications() {
    var u = me();
    if (!u) { location.hash = '#/'; return; }
    var mine = DB.notifications.filter(function (n) { return n.userId === u.id; });
    var typeConf = {
      like: ['heart', 'linear-gradient(135deg,#F59E0B,#FB7185)'], comment: ['message', 'linear-gradient(135deg,#4F6BF0,#22C3E6)'],
      follow: ['users', 'linear-gradient(135deg,#16A34A,#22C3E6)'], dm: ['send', 'linear-gradient(135deg,#7C5CF0,#A78BFA)'],
      system: ['bell', 'linear-gradient(135deg,#0EA5E9,#4F6BF0)']
    };
    $('feed').innerHTML =
      '<div class="back-row"><a class="back-link" href="#/">' + icon('arrow-left') + '返回首页</a></div>' +
      '<div class="feed-toolbar"><div class="section-title">' + icon('bell') + '通知中心</div><div class="grow"></div>' +
      '<button class="btn btn-sm" data-action="read-all">全部标为已读</button></div>' +
      '<div class="rail-card" style="margin-top:2px">' +
        (mine.length ? mine.map(function (n) {
          var conf = typeConf[n.type] || typeConf.system;
          var actor = userById(n.actorId);
          return '<a class="notif-item' + (n.read ? '' : ' unread') + '" href="' + (n.postId ? '#/post/' + n.postId : '#/notifications') + '" data-action="read-notif" data-id="' + n.id + '">' +
            '<span class="n-icon" style="background:' + conf[1] + '">' + icon(conf[0]) + '</span>' +
            '<span class="n-main"><span class="n-text">' + (actor ? '<b>' + esc(actor.name) + '</b> ' : '') + esc(n.text) + '</span>' +
            '<time>' + timeAgo(n.createdAt) + '</time></span></a>';
        }).join('') : '<div class="empty" style="padding:40px">' + icon('bell') + '<h3>暂无通知</h3><p>点赞、评论、关注都会在这里提醒你</p></div>') +
      '</div>';
    injectIcons($('feed'));
  }

  /* ── 我的主页（进度管理） ── */
  function renderMe() {
    var u = me();
    if (!u) { location.hash = '#/'; return; }
    var p = DB.progress[u.id] || {};
    var last7 = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(Date.now() - i * D);
      var ds = dayStr(d.getTime());
      last7.push({ ds: ds, dow: '日一二三四五六'.charAt(d.getDay()), on: (DB.checkins[u.id] || []).indexOf(ds) >= 0, today: i === 0 });
    }
    var medals = MEDALS.map(function (m) {
      var on = m.check(u);
      return '<div class="medal' + (on ? '' : ' locked') + '"><span class="m-icon" style="background:' + m.color + '">' + icon(m.icon) + '</span><div><h4>' + m.name + '</h4><p>' + m.desc + (on ? ' · 已获得' : ' · 未解锁') + '</p></div></div>';
    }).join('');

    $('feed').innerHTML =
      '<div class="back-row"><a class="back-link" href="#/user/' + u.id + '">' + icon('arrow-left') + '返回个人主页</a></div>' +
      '<div class="section-title">' + icon('target') + '我的学习进度</div>' +
      '<div class="progress-card"><h3>' + icon('calendar') + '最近 7 天打卡</h3>' +
        '<div class="cal-grid">' + last7.map(function (d) {
          return '<div class="cal-day' + (d.on ? ' on' : '') + (d.today ? ' today' : '') + '" title="' + d.ds + '">' + (d.on ? '✓' : d.dow) + '</div>';
        }).join('') + '</div></div>' +
      MODULES.map(function (m) {
        return renderProgressPanel(m.id);
      }).join('') +
      '<div class="progress-card"><h3>' + icon('award') + '我的徽章</h3><div class="badge-wall">' + medals + '</div></div>';
    injectIcons($('feed'));
  }

  /* ── 弹层 ── */
  var modalOpenAt = 0;
  function openModal(html, narrow) {
    modalOpenAt = Date.now();
    $('modal-root').innerHTML = '<div class="modal-scrim" data-action="scrim-close">' +
      '<div class="modal' + (narrow ? ' modal-narrow' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    injectIcons($('modal-root'));
    var first = $('modal-root').querySelector('input,textarea,select,button');
    if (first) first.focus();
  }
  function closeModal() { $('modal-root').innerHTML = ''; }

  function authModal(mode) {
    openModal(
      '<div class="modal-head"><h2>' + (mode === 'login' ? '登录' : '注册') + '</h2><button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('x') + '</button></div>' +
      '<div class="auth-tabs"><button class="' + (mode === 'login' ? 'active' : '') + '" data-action="auth-tab" data-mode="login">登录</button><button class="' + (mode === 'register' ? 'active' : '') + '" data-action="auth-tab" data-mode="register">注册</button></div>' +
      '<div class="form-err" id="authErr"></div>' +
      (mode === 'register' ? '<div class="field"><label>昵称 <span class="req">*</span></label><input type="text" id="authName" maxlength="16" placeholder="2-16 个字符"></div>' : '') +
      '<div class="field"><label>邮箱 <span class="req">*</span></label><input type="email" id="authEmail" placeholder="you@example.com" autocomplete="email"></div>' +
      '<div class="field"><label>密码 <span class="req">*</span></label><input type="password" id="authPass" placeholder="至少 6 位" autocomplete="' + (mode === 'login' ? 'current-password' : 'new-password') + '"></div>' +
      (mode === 'login' ? '<div class="hint" style="margin-bottom:6px">演示账号：admin@stk.cn / 123456（或 algo@ / backend@ / ai@）</div>' : '') +
      '<div class="modal-foot"><button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="do-auth" data-mode="' + mode + '">' + (mode === 'login' ? '登录' : '注册并登录') + '</button></div>', true
    );
  }

  function composeModal(existing) {
    var m = moduleById(existing ? existing.module : (composeModule || 'frontend'));
    var pick = m.tags || [];
    var pickedTags = existing ? (existing.tags || []) : [];
    openModal(
      '<div class="modal-head"><h2>' + (existing ? '编辑帖子' : '发布新帖') + '</h2><button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('x') + '</button></div>' +
      '<div class="field"><label>标题 <span class="req">*</span></label><input type="text" id="postTitle" maxlength="80" placeholder="一句话说清你的话题" value="' + esc(existing ? existing.title : '') + '"></div>' +
      '<div class="field"><label>技能模块 <span class="req">*</span></label><select id="postModule" data-action="compose-module">' +
        MODULES.map(function (x) { return '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>标签（点击选择，最多 3 个）</label><div class="tag-pick" id="tagPick">' + renderTagPick(pickedTags) + '</div></div>' +
      '<div class="field"><label>正文 <span class="req">*</span></label><textarea id="postContent" placeholder="支持 Markdown：**加粗**、标题、列表、```代码块```…">' + esc(existing ? existing.content : '') + '</textarea>' +
      '<div class="hint">' + icon('info') + ' 支持 Markdown 语法，代码块用 ``` 包裹</div></div>' +
      '<div class="modal-foot"><button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-post" data-id="' + (existing ? existing.id : '') + '">' + (existing ? '保存修改' : '发布') + '</button></div>'
    );
  }
  var composeModule = 'frontend';
  function renderTagPick(picked) {
    var m = moduleById(composeModule);
    return (m.tags || []).map(function (t) {
      return '<button class="tp-item' + (picked.indexOf(t) >= 0 ? ' picked' : '') + '" data-action="pick-tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
  }
  function currentPickedTags() {
    return Array.prototype.slice.call(document.querySelectorAll('#tagPick .tp-item.picked')).map(function (b) { return b.getAttribute('data-tag'); });
  }

  function confirmModal(title, text, onOk) {
    openModal(
      '<div class="modal-head"><h2>' + esc(title) + '</h2><button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('x') + '</button></div>' +
      '<p style="font-size:13.5px;color:var(--ink-2);line-height:1.8">' + text + '</p>' +
      '<div class="modal-foot"><button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" id="confirmOk" data-action="confirm-ok" style="background:var(--danger);border-color:var(--danger)">确认</button></div>', true
    );
    window.__confirmOk = onOk;
  }

  /* ── 动作分发 ── */
  function act(action, el, e) {
    var id = el.getAttribute('data-id') || '';
    var u = me();
    switch (action) {
      case 'open-post': {
        // 卡片内的链接/按钮（作者名等）不触发打开帖子
        var hit = e && e.target ? e.target.closest('a, button') : null;
        if (hit && el.contains(hit)) break;
        location.hash = '#/post/' + id;
        break;
      }
      case 'feed-tab': feedState.tab = el.getAttribute('data-tab'); renderFeed(); break;
      case 'module-filter': feedState.moduleFilter = el.getAttribute('data-mid') || null; renderFeed(); renderShell(); break;
      case 'module-tab':
        moduleTab = el.getAttribute('data-tab');
        location.hash = '#/module/' + el.getAttribute('data-mid') + '/' + (moduleTab === 'intro' ? 'intro' : moduleTab);
        break;
      case 'compose':
        if (!u) { toast('请先登录'); authModal('login'); return; }
        composeModule = el.getAttribute('data-mid') || composeModule;
        composeModal(null);
        break;
      case 'compose-module': composeModule = el.value; document.getElementById('tagPick').innerHTML = renderTagPick(currentPickedTags()); injectIcons(document.getElementById('tagPick')); break;
      case 'pick-tag': {
        var picked = currentPickedTags();
        var tag = el.getAttribute('data-tag');
        var idx = picked.indexOf(tag);
        if (idx >= 0) picked.splice(idx, 1);
        else if (picked.length >= 3) { toast('最多选择 3 个标签'); return; }
        else picked.push(tag);
        el.classList.toggle('picked');
        break;
      }
      case 'save-post': {
        var title = ($('postTitle').value || '').trim();
        var content = ($('postContent').value || '').trim();
        var module = $('postModule').value;
        var tags = currentPickedTags();
        if (!title) { toast('请填写标题'); return; }
        if (title.length < 4) { toast('标题至少 4 个字'); return; }
        if (!content) { toast('请填写正文'); return; }
        if (id) {
          var p = postById(id);
          p.title = title; p.content = content; p.module = module; p.tags = tags;
          toast('修改已保存');
        } else {
          var np = { id: uid('p'), authorId: u.id, module: module, title: title, content: content, tags: tags, views: 0, likes: [], favorites: [], createdAt: Date.now(), comments: [] };
          DB.posts.unshift(np);
          toast('发布成功！');
          addNotif(u.id, 'system', null, np.id, '你的帖子「' + title.slice(0, 18) + '」已发布');
        }
        save(); closeModal(); renderShell(); location.hash = '#/post/' + (id || np.id);
        break;
      }
      case 'edit-post': {
        var ep = postById(id);
        if (!ep || !u || ep.authorId !== u.id) return;
        composeModule = ep.module;
        composeModal(ep);
        break;
      }
      case 'delete-post':
        if (!u) return;
        confirmModal('删除帖子', '确定删除这篇帖子吗？评论也会一并删除，此操作不可恢复。', function () {
          DB.posts = DB.posts.filter(function (p) { return p.id !== id; });
          save(); closeModal(); toast('已删除'); location.hash = '#/';
        });
        break;
      case 'confirm-ok': closeModal(); if (window.__confirmOk) { var fn = window.__confirmOk; window.__confirmOk = null; fn(); } break;
      case 'like-post': {
        if (!u) { authModal('login'); return; }
        var lp = postById(id); if (!lp) return;
        var i = (lp.likes || []).indexOf(u.id);
        if (i >= 0) lp.likes.splice(i, 1); else { lp.likes.push(u.id); if (lp.authorId !== u.id) addNotif(lp.authorId, 'like', u.id, lp.id, '赞了你的帖子《' + lp.title.slice(0, 16) + '》'); }
        save(); renderPost(id);
        break;
      }
      case 'fav-post': {
        if (!u) { authModal('login'); return; }
        var fp = postById(id); if (!fp) return;
        var fi = (fp.favorites || []).indexOf(u.id);
        if (fi >= 0) { fp.favorites.splice(fi, 1); toast('已取消收藏'); } else { fp.favorites.push(u.id); toast('已收藏'); }
        save(); renderPost(id);
        break;
      }
      case 'like-comment': {
        if (!u) { authModal('login'); return; }
        var cp = postById(el.getAttribute('data-post')); if (!cp) return;
        var cc = (cp.comments || []).find(function (c) { return c.id === el.getAttribute('data-comment'); }); if (!cc) return;
        var ci = (cc.likes || []).indexOf(u.id);
        if (ci >= 0) cc.likes.splice(ci, 1); else { cc.likes.push(u.id); if (cc.authorId !== u.id) addNotif(cc.authorId, 'like', u.id, cp.id, '赞了你的评论'); }
        save(); renderPost(cp.id);
        break;
      }
      case 'reply-comment': {
        if (!u) { authModal('login'); return; }
        var name = el.getAttribute('data-name');
        var ci2 = $('commentInput');
        if (ci2) { ci2.value = '@' + name + ' '; ci2.focus(); ci2.dataset.reply = el.getAttribute('data-comment'); ci2.dataset.replyName = name; }
        break;
      }
      case 'add-comment': {
        if (!u) { authModal('login'); return; }
        var ap = postById(id); if (!ap) return;
        var box = $('commentInput'); var txt = (box.value || '').trim();
        if (!txt) { toast('评论内容不能为空'); return; }
        ap.comments = ap.comments || [];
        var replyName = box.dataset.replyName || null;
        ap.comments.push({ id: uid('c'), authorId: u.id, content: txt, replyTo: replyName, likes: [], createdAt: Date.now() });
        if (ap.authorId !== u.id) addNotif(ap.authorId, 'comment', u.id, ap.id, '评论了你的帖子《' + ap.title.slice(0, 16) + '》');
        save(); renderPost(ap.id); toast('评论成功');
        break;
      }
      case 'follow': {
        if (!u) { authModal('login'); return; }
        var tu = userById(id); if (!tu || id === u.id) return;
        var fi2 = (u.following || []).indexOf(id);
        if (fi2 >= 0) { u.following.splice(fi2, 1); var tfi = (tu.followers || []).indexOf(u.id); if (tfi >= 0) tu.followers.splice(tfi, 1); toast('已取消关注'); }
        else { (u.following = u.following || []).push(id); (tu.followers = tu.followers || []).push(u.id); toast('已关注 ' + tu.name); addNotif(id, 'follow', u.id, null, '关注了你'); }
        save(); renderShell();
        var hash = location.hash;
        if (hash.indexOf('#/post/') === 0) renderPost(id2(hash));
        else if (hash.indexOf('#/user/') === 0) renderUser(hash.slice(7));
        else if (hash.indexOf('#/') === 0 || hash === '' ) renderFeed();
        break;
      }
      case 'dm': { if (!u) { authModal('login'); return; } location.hash = '#/messages/' + id; break; }
      case 'open-dm': dmPeer = id; renderMessages(id); break;
      case 'send-dm': {
        var si = $('dmInput'); var stxt = (si.value || '').trim();
        if (!stxt) return;
        DB.messages.push({ id: uid('m'), from: u.id, to: id, text: stxt, at: Date.now(), read: false });
        si.value = '';
        save(); renderMessages(id); toast('已发送');
        break;
      }
      case 'checkin': {
        if (!u) { authModal('login'); return; }
        var list = DB.checkins[u.id] || (DB.checkins[u.id] = []);
        if (list.indexOf(today()) >= 0) { toast('今天已经打过卡啦'); return; }
        list.push(today()); save(); toast('打卡成功！连续 ' + streakDays(u.id) + ' 天'); renderShell(); renderSidebar();
        break;
      }
      case 'set-status': {
        var mid = el.getAttribute('data-mid');
        var st = +el.getAttribute('data-status');
        var prog = DB.progress[u.id] || (DB.progress[u.id] = {});
        var cur = prog[mid] || (prog[mid] = { status: 0, percent: 0, log: [] });
        cur.status = st;
        if (st === 2 && cur.percent < 100) cur.percent = 100;
        save(); renderModule(mid);
        break;
      }
      case 'set-percent': {
        var mid2 = el.getAttribute('data-mid');
        var prog2 = DB.progress[u.id] || (DB.progress[u.id] = {});
        var cur2 = prog2[mid2] || (prog2[mid2] = { status: 1, percent: 0, log: [] });
        cur2.percent = +el.value;
        if (cur2.percent >= 100) { cur2.percent = 100; cur2.status = 2; } else if (cur2.percent > 0 && cur2.status === 0) cur2.status = 1;
        var pv = $('percentVal'); if (pv) pv.textContent = cur2.percent + '%';
        save();
        break;
      }
      case 'add-log': {
        var mid3 = el.getAttribute('data-mid');
        var li = $('logInput'); var ltxt = (li.value || '').trim();
        if (!ltxt) { toast('写点内容再记录吧'); return; }
        var prog3 = DB.progress[u.id] || (DB.progress[u.id] = {});
        var cur3 = prog3[mid3] || (prog3[mid3] = { status: 1, percent: 0, log: [] });
        if (cur3.status === 0) cur3.status = 1;
        if (cur3.percent === 0) cur3.percent = 10;
        cur3.log.push({ date: today(), text: ltxt });
        save(); renderModule(mid3); toast('学习记录已保存');
        break;
      }
      case 'auth': authModal(el.getAttribute('data-mode')); break;
      case 'auth-tab': authModal(el.getAttribute('data-mode')); break;
      case 'do-auth': {
        var mode = el.getAttribute('data-mode');
        var email = ($('authEmail').value || '').trim().toLowerCase();
        var pass = $('authPass').value || '';
        var err = $('authErr');
        err.classList.remove('show');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = '请输入有效的邮箱地址'; err.classList.add('show'); return; }
        if (pass.length < 6) { err.textContent = '密码至少 6 位'; err.classList.add('show'); return; }
        var existing = DB.users.find(function (x) { return x.email === email; });
        if (mode === 'register') {
          var name = ($('authName').value || '').trim();
          if (name.length < 2 || name.length > 16) { err.textContent = '昵称需 2-16 个字符'; err.classList.add('show'); return; }
          if (existing) { err.textContent = '该邮箱已注册，请直接登录'; err.classList.add('show'); return; }
          if (DB.users.some(function (x) { return x.name === name; })) { err.textContent = '昵称已被占用'; err.classList.add('show'); return; }
          var nu = { id: uid('u'), name: name, email: email, pass: hashPass(pass), bio: '这位同学还没有填写简介。', role: '学生', joinedAt: Date.now(), followers: [], following: ['u1'], color: DB.users.length % AVATARS.length };
          DB.users.push(nu);
          session = nu.id; try { localStorage.setItem(SESSION_KEY, session); } catch (e) {}
          // 新用户欢迎通知 + 私信
          addNotif(nu.id, 'system', 'u1', null, '欢迎加入栈知映学习论坛！看看「论坛使用指南」快速上手。');
          DB.notifications.forEach(function (n) { if (n.userId === nu.id && !n.read) { /* keep */ } });
          DB.messages.push({ id: uid('m'), from: 'u1', to: nu.id, text: '欢迎来到栈知映学习论坛！有学习问题欢迎发帖交流，记得每天打卡哦～', at: Date.now(), read: false });
          save();
        } else {
          if (!existing) { err.textContent = '该邮箱尚未注册'; err.classList.add('show'); return; }
          if (existing.pass !== hashPass(pass)) { err.textContent = '密码不正确'; err.classList.add('show'); return; }
          session = existing.id; try { localStorage.setItem(SESSION_KEY, session); } catch (e) {}
        }
        closeModal(); toast(mode === 'login' ? '欢迎回来，' + me().name : '注册成功，欢迎 ' + me().name);
        renderShell(); renderFeed();
        break;
      }
      case 'logout':
        session = null; try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        renderShell(); renderFeed(); toast('已退出登录');
        break;
      case 'toggle-theme': toggleTheme(); break;
      case 'read-all':
        DB.notifications.forEach(function (n) { if (n.userId === u.id) n.read = true; });
        save(); renderTopbar(); renderNotifications(); toast('全部已读');
        break;
      case 'read-notif': {
        var nn = DB.notifications.find(function (n) { return n.id === id; });
        if (nn && !nn.read) { nn.read = true; save(); renderTopbar(); }
        break;
      }
      case 'close-modal': if (Date.now() - modalOpenAt < 250) break; closeModal(); break;
      case 'scrim-close':
        // 仅当点击的是遮罩本身（而非弹窗内部内容）时才关闭弹窗
        if (e && e.target && e.target.classList && e.target.classList.contains('modal-scrim')) {
          if (Date.now() - modalOpenAt < 250) break;
          closeModal();
        }
        break;
      case 'noop': break;
    }
  }
  function id2(hash) { var parts = hash.replace(/^#\//, '').split('/'); return parts[1]; }

  /* ── 密码散列（演示级，浏览器端无真安全可言） ── */
  function hashPass(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  }

  /* ── 主题 ── */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    $('themeBtn').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:100%;height:100%;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round">' + ICONS[t === 'dark' ? 'sun' : 'moon'] + '</svg>';
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* ── 渲染外壳 ── */
  function renderShell() { renderTopbar(); renderSidebar(); renderRail(); }

  /* ── 路由 ── */
  function route() {
    var hash = location.hash || '#/';
    // 先剥离 ? 后的查询串，避免 #/search?q= 被当成一段路由
    var qsPos = hash.indexOf('?');
    var pathOnly = qsPos >= 0 ? hash.slice(0, qsPos) : hash;
    var parts = pathOnly.replace(/^#\//, '').split('/');
    var seg = parts[0], arg = parts[1], extra = parts[2];
    // 导航高亮
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      var key = a.getAttribute('data-nav');
      var on = (key === 'home' && seg === '' && feedState.view === 'home') ||
               (key === 'module-' + arg && seg === 'module') ||
               (key === 'me' && (seg === 'me' || seg === 'user')) ||
               (key === 'notif' && seg === 'notifications') ||
               (key === 'all' && seg === 'all') ||
               (key === 'search' && seg === 'search' && !feedState.query && !feedState.favOnly) ||
               (key === 'favs' && feedState.favOnly) ||
               (key === 'module-' + feedState.moduleFilter && seg === 'search');
      a.classList.toggle('active', !!on);
    });
    closeModal();
    if (seg === '' ) { feedState = { view: 'home', tab: 'hot', query: null, favOnly: false, moduleFilter: null }; renderFeed(); }
    else if (seg === 'all') { feedState = { view: 'all', tab: 'latest', query: null, favOnly: false, moduleFilter: null }; renderFeed(); }
    else if (seg === 'module') { moduleTab = extra === 'discuss' ? 'discuss' : extra === 'resources' ? 'resources' : extra === 'progress' ? 'progress' : 'intro'; renderModule(arg); }
    else if (seg === 'post') renderPost(arg);
    else if (seg === 'user') renderUser(arg);
    else if (seg === 'messages') renderMessages(arg);
    else if (seg === 'notifications') renderNotifications();
    else if (seg === 'me') renderMe();
    else if (seg === 'search') {
      var qs = hash.indexOf('?');
      var params = qs >= 0 ? hash.slice(qs + 1) : '';
      feedState.view = 'all';
      feedState.query = '';
      feedState.favOnly = false;
      feedState.moduleFilter = null;
      params.split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0] === 'q') feedState.query = decodeURIComponent(p[1] || '').replace(/\+/g, ' ');
        if (p[0] === 'fav') feedState.favOnly = true;
      });
      if (!feedState.query && !feedState.favOnly) { feedState.query = null; feedState.tab = 'latest'; renderFeed(); }
      else renderFeed();
    }
    else { feedState = { view: 'home', tab: 'hot', query: null, favOnly: false, moduleFilter: null }; renderFeed(); }
    renderShell();
  }

  /* ── 事件绑定 ── */
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el) return;
      act(el.getAttribute('data-action'), el, e);
    });
    // select 变更与 range 拖动
    document.addEventListener('change', function (e) {
      var el = e.target.closest('[data-action]');
      if (el && el.getAttribute('data-action') === 'compose-module') act('compose-module', el, e);
    });
    document.addEventListener('input', function (e) {
      var el = e.target.closest('[data-action]');
      if (el && el.getAttribute('data-action') === 'set-percent') act('set-percent', el, e);
    });
    $('globalSearch').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var q = this.value.trim();
        location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/search?q=';
        if (!q) toast('输入关键词开始搜索');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
      if (e.key === '/' && document.activeElement && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault(); $('globalSearch').focus();
      }
    });
    $('themeBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleTheme(); });
    // 用户菜单
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('#userMenuBtn');
      var menu = $('userMenu');
      if (btn) { e.stopPropagation(); var hidden = menu.hidden; menu.hidden = !hidden; btn.setAttribute('aria-expanded', String(hidden)); return; }
      if (menu && !menu.hidden && !e.target.closest('#userMenu')) menu.hidden = true;
    });
    window.addEventListener('hashchange', route);
  }

  /* ── 初始化 ── */
  function init() {
    DB = load();
    loadSession();
    var savedTheme = null; try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
    applyTheme(savedTheme === 'dark' ? 'dark' : 'light');
    bindEvents();
    renderShell();
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
