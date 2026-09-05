import { useState } from "react";

// ── types ──────────────────────────────────────────────────────────────────
type Category = "全部" | "前端" | "算法" | "后端" | "AI" | "综合";
type Tab = "最新" | "热门" | "精华" | "打卡";

interface Post {
  id: number;
  title: string;
  summary: string;
  author: string;
  avatar: string;
  time: string;
  category: Exclude<Category, "全部">;
  tags: string[];
  views: number;
  replies: number;
  likes: number;
  pinned?: boolean;
  featured?: boolean;
}

interface TrendingPost {
  id: number;
  title: string;
  replies: number;
  category: Exclude<Category, "全部">;
}

// ── data ───────────────────────────────────────────────────────────────────
const POSTS: Post[] = [
  {
    id: 1,
    title: "2025届校招总结：字节、腾讯、阿里前端面试高频考点整理",
    summary: "整理了今年秋招 60+ 家公司的前端面试题，涵盖 React 原理、TypeScript 类型体操、浏览器渲染机制等核心模块，附详细解题思路。",
    author: "陈子阳",
    avatar: "C",
    time: "32 分钟前",
    category: "前端",
    tags: ["面试", "React", "TypeScript"],
    views: 4821,
    replies: 187,
    likes: 632,
    pinned: true,
    featured: true,
  },
  {
    id: 2,
    title: "动态规划专题：背包问题从零到精通（附 LeetCode 100 题清单）",
    summary: "从 01背包 到分组背包，彻底理清状态转移方程推导逻辑，每道题附时空复杂度分析与优化方案，适合刷题冲刺阶段系统梳理。",
    author: "林佳妮",
    avatar: "L",
    time: "1 小时前",
    category: "算法",
    tags: ["动态规划", "LeetCode", "背包"],
    views: 3102,
    replies: 94,
    likes: 418,
    featured: true,
  },
  {
    id: 3,
    title: "手写 Spring IoC 容器：深入理解依赖注入与 BeanFactory",
    summary: "从零实现一个轻量级 Spring IoC，覆盖 BeanDefinition 注册、反射实例化、属性注入、循环依赖解决（三级缓存）全流程。",
    author: "王鹏飞",
    avatar: "W",
    time: "3 小时前",
    category: "后端",
    tags: ["Spring", "Java", "IoC"],
    views: 2744,
    replies: 61,
    likes: 289,
  },
  {
    id: 4,
    title: "Transformer 注意力机制数学推导 + PyTorch 从零实现",
    summary: "一步步推导 Scaled Dot-Product Attention，然后用 PyTorch 手写 MultiHeadAttention 模块，帮助深刻理解 LLM 底层原理。",
    author: "赵晓雨",
    avatar: "Z",
    time: "5 小时前",
    category: "AI",
    tags: ["Transformer", "PyTorch", "LLM"],
    views: 5509,
    replies: 143,
    likes: 761,
  },
  {
    id: 5,
    title: "前端性能优化实战：首屏时间从 4.2s 压到 0.8s 的全过程",
    summary: "记录一次真实项目的性能调优经历：代码分割、图片懒加载、CDN 配置、Service Worker 缓存策略一套打出来，附 Lighthouse 截图对比。",
    author: "刘宇航",
    avatar: "L",
    time: "8 小时前",
    category: "前端",
    tags: ["性能优化", "Vite", "Web Vitals"],
    views: 3388,
    replies: 78,
    likes: 534,
  },
  {
    id: 6,
    title: "MySQL 索引失效的 12 种场景及优化方案",
    summary: "通过 EXPLAIN 分析，总结出最容易踩坑的索引失效案例：隐式类型转换、函数作用于索引列、OR 条件等，每种情况给出具体优化 SQL。",
    author: "郑思远",
    avatar: "Z",
    time: "昨天",
    category: "后端",
    tags: ["MySQL", "索引", "SQL优化"],
    views: 6201,
    replies: 212,
    likes: 877,
  },
  {
    id: 7,
    title: "【打卡第30天】RAG 系统从理论到生产部署全记录",
    summary: "用 LangChain + Chroma + Claude API 构建了一个企业知识库 QA 系统，今天整理文档召回率优化和 Prompt 工程的踩坑记录。",
    author: "徐欣然",
    avatar: "X",
    time: "昨天",
    category: "AI",
    tags: ["RAG", "LangChain", "向量数据库"],
    views: 2891,
    replies: 55,
    likes: 312,
  },
  {
    id: 8,
    title: "CSS Grid 深度解析：subgrid、masonry 与复杂布局实战",
    summary: "2025 年浏览器对 CSS Grid Level 2 的支持已相当完善，subgrid 和实验性 masonry 布局打开了全新可能，本文结合实际案例系统讲解。",
    author: "陈佳琳",
    avatar: "C",
    time: "2 天前",
    category: "前端",
    tags: ["CSS", "Grid", "布局"],
    views: 1873,
    replies: 42,
    likes: 198,
  },
];

const TRENDING: TrendingPost[] = [
  { id: 1, title: "字节一面：手写 Promise.all，边界条件怎么处理？", replies: 203, category: "前端" },
  { id: 2, title: "图论专题：Dijkstra vs 贝尔曼-福特最详细对比", replies: 156, category: "算法" },
  { id: 3, title: "Redis 持久化 RDB vs AOF 深度对比与选型建议", replies: 134, category: "后端" },
  { id: 4, title: "GPT-4o 与 Claude 3.5 在代码生成任务上的实测对比", replies: 289, category: "AI" },
  { id: 5, title: "Rust 所有权模型：写给 Java 开发者的入门指南", replies: 98, category: "后端" },
];

const HOT_TAGS = ["面试", "算法", "React", "Spring", "LLM", "TypeScript", "MySQL", "系统设计", "打卡", "源码分析"];

const LEADERBOARD = [
  { name: "赵晓雨", score: 2841, badge: "🥇" },
  { name: "林佳妮", score: 2630, badge: "🥈" },
  { name: "郑思远", score: 2418, badge: "🥉" },
  { name: "陈子阳", score: 1987, badge: "" },
  { name: "刘宇航", score: 1752, badge: "" },
];

// ── helpers ────────────────────────────────────────────────────────────────
const CAT_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  前端: { bg: "var(--tag-fe)", text: "var(--tag-fe-text)", dot: "#58A6FF" },
  算法: { bg: "var(--tag-algo)", text: "var(--tag-algo-text)", dot: "#3FB950" },
  后端: { bg: "var(--tag-be)", text: "var(--tag-be-text)", dot: "#FFA657" },
  AI: { bg: "var(--tag-ai)", text: "var(--tag-ai-text)", dot: "#D2A8FF" },
  综合: { bg: "var(--tag-gen)", text: "var(--tag-gen-text)", dot: "#E3B341" },
};

function catStyle(cat: string) {
  return CAT_STYLE[cat] ?? CAT_STYLE["综合"];
}

function fmtNum(n: number) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

// ── icons (inline svg) ─────────────────────────────────────────────────────
const Icon = {
  Search: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  ),
  Bell: ({ dot }: { dot?: boolean }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "relative" }}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {dot && <circle cx="18" cy="6" r="4" fill="#F78166" stroke="var(--bg-2)" strokeWidth="1.5" />}
    </svg>
  ),
  Eye: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Msg: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Heart: ({ filled }: { filled?: boolean }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? "var(--accent-orange)" : "none"} stroke={filled ? "var(--accent-orange)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  Pin: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
    </svg>
  ),
  Star: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-yellow)" stroke="none">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  Fire: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--accent-orange)" stroke="none">
      <path d="M12 0C8.5 5 10 9 7.5 11 6.3 12 5 10.5 5 10.5 3.5 17 8 20 12 24c4 0 8-3 9-8s-2-8-2-8-1.5 2-3 2c-1.5 0-2.5-3 0-6z" />
    </svg>
  ),
  Trophy: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 21 12 17 16 21"/><path d="M17 4H7v7a5 5 0 0 0 10 0V4z"/><path d="M17 4h2a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4h-1"/><path d="M7 4H5a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4h1"/>
    </svg>
  ),
  Hash: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>
      <line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>
    </svg>
  ),
  Plus: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Menu: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
};

// ── Avatar ─────────────────────────────────────────────────────────────────
function Avatar({ char, size = 28 }: { char: string; size?: number }) {
  const colors = ["#1F3A5F", "#2D3F1F", "#3D2B1A", "#2E1F4A", "#2A2420"];
  const idx = char.charCodeAt(0) % colors.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: colors[idx], border: "1.5px solid var(--border-soft)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, fontWeight: 600, color: "var(--text)",
      flexShrink: 0, fontFamily: "'Outfit', sans-serif",
    }}>
      {char}
    </div>
  );
}

// ── CategoryBadge ──────────────────────────────────────────────────────────
function CategoryBadge({ cat }: { cat: string }) {
  const s = catStyle(cat);
  return (
    <span style={{
      background: s.bg, color: s.text,
      padding: "2px 7px", borderRadius: 4,
      fontSize: 11, fontWeight: 600,
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: "0.03em", whiteSpace: "nowrap",
    }}>
      {cat}
    </span>
  );
}

// ── PostCard ───────────────────────────────────────────────────────────────
function PostCard({ post, liked, onLike }: { post: Post; liked: boolean; onLike: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "var(--bg-3)" : "var(--bg-2)",
        border: `1px solid ${post.featured ? "var(--accent-dim)" : "var(--border)"}`,
        borderRadius: 8,
        padding: "16px 18px",
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* featured stripe */}
      {post.featured && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: 3, background: "var(--accent)",
          borderRadius: "8px 0 0 8px",
        }} />
      )}

      <div style={{ paddingLeft: post.featured ? 8 : 0 }}>
        {/* header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {post.pinned && (
            <span style={{ color: "var(--accent-orange)", display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600 }}>
              <Icon.Pin /> 置顶
            </span>
          )}
          {post.featured && (
            <span style={{ color: "var(--accent-yellow)", display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600 }}>
              <Icon.Star /> 精华
            </span>
          )}
          <CategoryBadge cat={post.category} />
          {post.tags.map(t => (
            <span key={t} style={{
              color: "var(--text-muted)", fontSize: 11,
              background: "var(--bg-3)", padding: "1px 6px",
              borderRadius: 3, border: "1px solid var(--border)",
            }}>#{t}</span>
          ))}
        </div>

        {/* title */}
        <h3 style={{
          margin: 0, fontSize: 15, fontWeight: 600,
          color: hovered ? "var(--accent)" : "var(--text)",
          lineHeight: 1.45, marginBottom: 6,
          fontFamily: "'Outfit', 'PingFang SC', sans-serif",
          transition: "color 0.15s",
        }}>{post.title}</h3>

        {/* summary */}
        <p style={{
          margin: 0, color: "var(--text-2)", fontSize: 13,
          lineHeight: 1.6, marginBottom: 12,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{post.summary}</p>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Avatar char={post.avatar} size={20} />
            <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{post.author}</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· {post.time}</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <StatBtn icon={<Icon.Eye />} val={fmtNum(post.views)} />
            <StatBtn icon={<Icon.Msg />} val={String(post.replies)} />
            <button
              onClick={e => { e.stopPropagation(); onLike(); }}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", gap: 4,
                color: liked ? "var(--accent-orange)" : "var(--text-muted)",
                fontSize: 12, fontWeight: liked ? 600 : 400,
                transition: "color 0.15s",
              }}
            >
              <Icon.Heart filled={liked} />
              {fmtNum(post.likes + (liked ? 1 : 0))}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function StatBtn({ icon, val }: { icon: React.ReactNode; val: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 12 }}>
      {icon}{val}
    </span>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────
const NAV_CATS: Array<{ label: Category; count: number }> = [
  { label: "全部", count: 2841 },
  { label: "前端", count: 843 },
  { label: "算法", count: 621 },
  { label: "后端", count: 594 },
  { label: "AI", count: 512 },
  { label: "综合", count: 271 },
];

function Sidebar({ active, onSelect }: { active: Category; onSelect: (c: Category) => void }) {
  const [streak] = useState(7);
  return (
    <aside style={{
      width: 210, flexShrink: 0,
      display: "flex", flexDirection: "column", gap: 0,
    }}>
      {/* user card */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: 8, padding: "14px 14px 12px",
        marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Avatar char="我" size={36} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, fontFamily: "'Outfit', sans-serif" }}>秦思羽</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>计算机科学 · 大三</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, textAlign: "center" }}>
          {[["帖子", 47], ["关注", 128], ["获赞", 893]].map(([k, v]) => (
            <div key={k as string} style={{ background: "var(--bg-3)", borderRadius: 5, padding: "6px 0" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", fontFamily: "'Outfit', sans-serif" }}>{v}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{k}</div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 10, background: "var(--bg-3)", borderRadius: 5,
          padding: "7px 10px", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>🔥 连续打卡</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-orange)", fontFamily: "'JetBrains Mono', monospace" }}>{streak} 天</span>
        </div>
      </div>

      {/* navigation */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: 8, overflow: "hidden", marginBottom: 10,
      }}>
        <div style={{ padding: "10px 12px 8px", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
          分类浏览
        </div>
        {NAV_CATS.map(({ label, count }) => {
          const isActive = active === label;
          const s = label === "全部" ? null : catStyle(label);
          return (
            <button key={label} onClick={() => onSelect(label)} style={{
              width: "100%", background: isActive ? "var(--accent-dim)" : "none",
              border: "none", borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              padding: "9px 12px", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              color: isActive ? "var(--accent)" : "var(--text-2)",
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              transition: "all 0.12s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {s && <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />}
                {!s && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text-muted)", flexShrink: 0 }} />}
                {label}
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      {/* quick actions */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: 8, overflow: "hidden",
      }}>
        {[
          { label: "我的帖子", icon: "📝" },
          { label: "收藏夹", icon: "⭐" },
          { label: "学习打卡", icon: "📅" },
          { label: "进度追踪", icon: "📊" },
        ].map(({ label, icon }) => (
          <button key={label} style={{
            width: "100%", background: "none", border: "none",
            padding: "9px 12px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 9,
            color: "var(--text-2)", fontSize: 13, textAlign: "left",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-3)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            <span style={{ fontSize: 14 }}>{icon}</span>{label}
          </button>
        ))}
      </div>
    </aside>
  );
}

// ── RightRail ──────────────────────────────────────────────────────────────
function RightRail() {
  return (
    <aside style={{ width: 258, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* trending */}
      <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{
          padding: "10px 14px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 12, fontWeight: 700, color: "var(--text-2)", letterSpacing: "0.05em", textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          <Icon.Fire /> 今日热议
        </div>
        {TRENDING.map((t, i) => (
          <div key={t.id} style={{
            padding: "10px 14px", borderBottom: i < TRENDING.length - 1 ? "1px solid var(--border)" : "none",
            cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 10,
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-3)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            <span style={{
              fontSize: 12, fontWeight: 700, color: i < 3 ? "var(--accent)" : "var(--text-muted)",
              fontFamily: "'JetBrains Mono', monospace", minWidth: 16, paddingTop: 1,
            }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.45, marginBottom: 4 }}>{t.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CategoryBadge cat={t.category} />
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t.replies} 回复</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* hot tags */}
      <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px 12px" }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: "var(--text-2)", letterSpacing: "0.05em", textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace", marginBottom: 10,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <Icon.Hash /> 热门标签
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {HOT_TAGS.map(t => (
            <button key={t} style={{
              background: "var(--bg-3)", border: "1px solid var(--border)",
              borderRadius: 4, padding: "4px 8px", cursor: "pointer",
              fontSize: 11, color: "var(--text-2)", fontFamily: "'JetBrains Mono', monospace",
              transition: "all 0.12s",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--accent-dim)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--text-2)"; e.currentTarget.style.borderColor = "var(--border)"; }}
            >#{t}</button>
          ))}
        </div>
      </div>

      {/* leaderboard */}
      <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{
          padding: "10px 14px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 12, fontWeight: 700, color: "var(--text-2)", letterSpacing: "0.05em", textTransform: "uppercase",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          <Icon.Trophy /> 本周贡献榜
        </div>
        {LEADERBOARD.map((u, i) => (
          <div key={u.name} style={{
            padding: "9px 14px", borderBottom: i < LEADERBOARD.length - 1 ? "1px solid var(--border)" : "none",
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-3)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            <span style={{ fontSize: 14, minWidth: 20, textAlign: "center" }}>{u.badge || <span style={{ color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{i + 1}</span>}</span>
            <Avatar char={u.name[0]} size={24} />
            <span style={{ fontSize: 13, color: "var(--text-2)", flex: 1 }}>{u.name}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-yellow)", fontFamily: "'JetBrains Mono', monospace" }}>{u.score.toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* site stats */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8,
        padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
      }}>
        {[["12,841", "注册用户"], ["3,204", "本月帖子"], ["87,203", "总回复数"], ["247", "今日活跃"]].map(([v, l]) => (
          <div key={l} style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)", fontFamily: "'Outfit', sans-serif" }}>{v}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{l}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [activeCategory, setActiveCategory] = useState<Category>("全部");
  const [activeTab, setActiveTab] = useState<Tab>("最新");
  const [search, setSearch] = useState("");
  const [likedPosts, setLikedPosts] = useState<Set<number>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const TABS: Tab[] = ["最新", "热门", "精华", "打卡"];

  const filtered = POSTS.filter(p => {
    const matchCat = activeCategory === "全部" || p.category === activeCategory;
    const matchSearch = !search || p.title.includes(search) || p.summary.includes(search) || p.tags.some(t => t.includes(search));
    return matchCat && matchSearch;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (activeTab === "热门") return (b.views + b.likes * 3) - (a.views + a.likes * 3);
    if (activeTab === "精华") return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
    return b.id - a.id;
  });

  const toggleLike = (id: number) => {
    setLikedPosts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* ── topbar ── */}
      <header style={{
        height: 52, background: "var(--bg-2)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center",
        padding: "0 20px", gap: 16,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        {/* menu */}
        <button onClick={() => setSidebarOpen(v => !v)} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--text-muted)", padding: 6, borderRadius: 5, display: "flex",
        }}>
          <Icon.Menu />
        </button>

        {/* logo */}
        <a href="#/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", flexShrink: 0 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 6,
            background: "rgb(29, 78, 216)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, fontWeight: 800, color: "#fff",
            fontFamily: "'Outfit', sans-serif",
          }}>栈</div>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 16, color: "var(--text)", letterSpacing: "-0.01em" }}>
            栈知映<span style={{ fontWeight: 300, color: "var(--text-muted)", marginLeft: 2 }}>论坛</span>
          </div>
        </a>

        {/* search */}
        <div style={{
          flex: 1, maxWidth: 520,
          background: "var(--bg)", border: "1px solid var(--border-soft)",
          borderRadius: 6, display: "flex", alignItems: "center", gap: 8,
          padding: "0 10px", height: 32,
        }}>
          <span style={{ color: "var(--text-muted)", display: "flex" }}><Icon.Search /></span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索帖子、标签、用户…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: "var(--text)", fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          {!search && <kbd style={{
            background: "var(--bg-3)", border: "1px solid var(--border-soft)",
            borderRadius: 3, padding: "1px 5px", fontSize: 11, color: "var(--text-muted)",
            fontFamily: "'JetBrains Mono', monospace",
          }}>/</kbd>}
        </div>

        {/* actions */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <IconBtn title="通知"><Icon.Bell dot /></IconBtn>
          <button style={{
            background: "var(--bg-3)", border: "1px solid var(--border-soft)", borderRadius: 6,
            padding: "6px 12px", cursor: "pointer",
            color: "var(--text)", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 5,
            fontFamily: "'Outfit', sans-serif",
          }}>
            <Icon.Plus />发帖
          </button>
          <div style={{ marginLeft: 4 }}><Avatar char="我" size={30} /></div>
        </div>
      </header>

      {/* ── body ── */}
      <div style={{
        display: "flex", gap: 16, padding: "16px 20px",
        maxWidth: 1280, width: "100%", margin: "0 auto", flex: 1,
        alignItems: "flex-start",
      }}>
        {/* sidebar */}
        {sidebarOpen && (
          <Sidebar active={activeCategory} onSelect={setActiveCategory} />
        )}

        {/* feed */}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* tabs + stats bar */}
          <div style={{
            background: "var(--bg-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "10px 16px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", gap: 2 }}>
              {TABS.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  background: activeTab === tab ? "var(--accent-dim)" : "none",
                  border: "none", borderRadius: 5, padding: "5px 14px", cursor: "pointer",
                  color: activeTab === tab ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
                  transition: "all 0.12s",
                  fontFamily: "'Outfit', sans-serif",
                }}>{tab}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              共 <span style={{ color: "var(--accent)" }}>{sorted.length}</span> 个话题
            </div>
          </div>

          {/* posts */}
          {sorted.length === 0 ? (
            <div style={{
              background: "var(--bg-2)", border: "1px solid var(--border)",
              borderRadius: 8, padding: "48px 0", textAlign: "center",
              color: "var(--text-muted)", fontSize: 14,
            }}>暂无相关帖子</div>
          ) : (
            sorted.map(post => (
              <PostCard
                key={post.id}
                post={post}
                liked={likedPosts.has(post.id)}
                onLike={() => toggleLike(post.id)}
              />
            ))
          )}

          {/* load more */}
          <button style={{
            background: "var(--bg-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "12px", cursor: "pointer",
            color: "var(--text-muted)", fontSize: 13,
            transition: "all 0.12s",
            fontFamily: "'Outfit', sans-serif",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            加载更多帖子
          </button>
        </main>

        {/* right rail */}
        <RightRail />
      </div>
    </div>
  );
}

function IconBtn({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <button title={title} style={{
      background: "none", border: "none", cursor: "pointer",
      color: "var(--text-muted)", padding: "6px 7px", borderRadius: 5,
      display: "flex", alignItems: "center",
      transition: "color 0.12s, background 0.12s",
    }}
      onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-3)"; }}
      onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
    >{children}</button>
  );
}
