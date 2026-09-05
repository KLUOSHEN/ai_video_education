"""
题目生成引擎 — 基于关键词智能生成多题型、多难度的教学题目。
"""

import random
import re
from typing import Optional

from api.models import VideoGeneration, Quiz


# ═══════════════════════════════════════════════
# CS 知识题库模板
# ═══════════════════════════════════════════════

_QUIZ_TEMPLATES = {
    "排序": {
        "single": [
            {"q": "快速排序最坏时间复杂度？", "opts": ["O(n log n)", "O(n²)", "O(n)", "O(log n)"], "ans": "B", "exp": "最坏情况下每次 pivot 都是最小/最大值，分区极不平衡，退化为 O(n²)。"},
            {"q": "归并排序的空间复杂度？", "opts": ["O(1)", "O(log n)", "O(n)", "O(n²)"], "ans": "C", "exp": "归并需要 O(n) 临时数组来合并两个有序子数组。"},
            {"q": "冒泡排序最优时间复杂度？", "opts": ["O(1)", "O(n)", "O(n log n)", "O(n²)"], "ans": "B", "exp": "已有序时只需一趟扫描确认无交换，O(n)。"},
        ],
        "judge": [
            {"q": "归并排序是稳定的排序算法。", "ans": "true", "exp": "归并排序在合并时不改变相等元素的相对顺序。"},
            {"q": "堆排序的空间复杂度是 O(n)。", "ans": "false", "exp": "堆排序可以原地排序（in-place），空间复杂度仅为 O(1)。"},
            {"q": "选择排序比较次数与初始顺序无关。", "ans": "true", "exp": "选择排序无论初始顺序，每次都需遍历未排序部分找最小元，比较次数恒为 n(n-1)/2。"},
        ],
        "fill": [
            {"q": "快速排序采用____算法思想。", "ans": "分治", "exp": "快速排序以 pivot 划分左右子问题，递归求解后合并。"},
            {"q": "冒泡排序每趟将当前未排序部分的最大值移动到____位置。", "ans": "最右", "exp": "每趟冒泡将当前区间的最大元素\"浮\"到右端已排序区。"},
        ],
    },
    "TCP": {
        "single": [
            {"q": "TCP 连接建立需要几次交互？", "opts": ["2次", "3次", "4次", "1次"], "ans": "B", "exp": "三次握手：SYN → SYN+ACK → ACK。"},
            {"q": "TIME_WAIT 持续多久？", "opts": ["1MSL", "2MSL", "30秒", "1分钟"], "ans": "B", "exp": "主动关闭方等待 2MSL 确保最后的 ACK 被收到。"},
        ],
        "judge": [
            {"q": "TCP 是面向无连接的协议。", "ans": "false", "exp": "TCP 是面向连接的传输协议，UDP 才是无连接。"},
            {"q": "TCP 提供拥塞控制机制。", "ans": "true", "exp": "TCP 有慢启动、拥塞避免、快重传、快恢复四种拥塞控制机制。"},
        ],
    },
    "进程": {
        "single": [
            {"q": "资源分配的基本单位？", "opts": ["线程", "进程", "协程", "管程"], "ans": "B", "exp": "进程拥有独立地址空间，是 OS 资源分配的基本单位。"},
            {"q": "时间片轮转属哪种调度？", "opts": ["非抢占式", "抢占式", "先来先服务", "短作业优先"], "ans": "B", "exp": "时间片轮转（RR）中时间片用完即强制切换，属抢占式。"},
            {"q": "死锁的必要条件不包含？", "opts": ["互斥", "环路等待", "优先级反转", "不可剥夺"], "ans": "C", "exp": "死锁四条件：互斥、占有等待、不可剥夺、循环等待。"},
        ],
        "judge": [
            {"q": "同一进程的线程共享堆空间。", "ans": "true", "exp": "线程共享进程的代码段、数据段、堆；但各自拥有独立的栈和寄存器。"},
            {"q": "用户级线程的切换需要内核介入。", "ans": "false", "exp": "用户级线程在用户空间管理，切换无需陷入内核态。"},
        ],
    },
    "二叉树": {
        "single": [
            {"q": "中序遍历顺序？", "opts": ["根-左-右", "左-根-右", "左-右-根", "按层"], "ans": "B", "exp": "中序：左子树 → 根 → 右子树，BST 中序遍历得到有序序列。"},
            {"q": "层序遍历使用什么结构？", "opts": ["栈", "堆", "队列", "集合"], "ans": "C", "exp": "层序即 BFS，利用队列 FIFO 特性逐层访问。"},
            {"q": "完全二叉树第 k 层最多几个节点？", "opts": ["k", "2^k - 1", "2^(k-1)", "k²"], "ans": "C", "exp": "二叉树第 k 层（根为第 1 层）最多有 2^(k-1) 个节点。"},
        ],
        "judge": [
            {"q": "满二叉树一定是完全二叉树。", "ans": "true", "exp": "满二叉树的每层都填满，满足完全二叉树定义。"},
            {"q": "二叉搜索树的中序序列是无序的。", "ans": "false", "exp": "BST 中序遍历严格按关键码升序输出。"},
        ],
        "fill": [
            {"q": "二叉树前序遍历的访问顺序是：____。", "ans": "根左右", "exp": "前序（Preorder）：先访问根节点，再遍历左子树，最后右子树。"},
        ],
    },
    "数据库": {
        "single": [
            {"q": "ACID 中的 I 代表？", "opts": ["完整性", "隔离性", "不可变性", "继承"], "ans": "B", "exp": "Isolation = 隔离性，事务并发执行时互不干扰。"},
            {"q": "MySQL 默认存储引擎是？", "opts": ["MyISAM", "InnoDB", "MEMORY", "CSV"], "ans": "B", "exp": "MySQL 5.5+ 默认使用 InnoDB，支持事务和行级锁。"},
            {"q": "第三范式（3NF）消除什么？", "opts": ["部分依赖", "传递依赖", "多值依赖", "函数依赖"], "ans": "B", "exp": "3NF 要求非主属性不传递依赖于候选键。"},
        ],
        "judge": [
            {"q": "索引一定能加速查询。", "ans": "false", "exp": "索引过多会拖慢写操作，且查询优化器可能选择全表扫描。"},
        ],
    },
    "HTTP": {
        "single": [
            {"q": "HTTP 状态码 301 表示？", "opts": ["临时重定向", "永久重定向", "客户端错误", "服务器错误"], "ans": "B", "exp": "301 Moved Permanently，资源已永久转移到新 URL。"},
            {"q": "TLS 握手中，客户端首先发送？", "opts": ["Certificate", "ServerHello", "ClientHello", "Finished"], "ans": "C", "exp": "TLS 握手以 ClientHello 开始，包含支持的密码套件和随机数。"},
        ],
    },
}


def _extract_topic_keywords(text: str) -> list:
    """从输入文本中提取题库主题关键词"""
    mapping = {
        "排序|sort|快排|归并|冒泡|堆排|选择排序": "排序",
        "tcp|握手|挥手|传输层|网络协议": "TCP",
        "进程|线程|死锁|调度|并发|同步|信号量": "进程",
        "二叉|树|遍[历历]|bst|红黑|b树|前序|中序|后序|层序": "二叉树",
        "sql|数据库|mysql|acid|事务|索引|范式|join": "数据库",
        "http|https|状态码|ssl|tls|握手": "HTTP",
    }
    results = []
    text_lower = text.lower()
    for pattern, topic in mapping.items():
        if re.search(pattern, text_lower):
            results.append(topic)
    return results


def _generate_quizzes(
    task: VideoGeneration,
    difficulty: str,
    count: int,
) -> list:
    """
    根据任务查询文本生成题目。

    Args:
        task: 视频生成任务
        difficulty: 难度 (easy/medium/hard)
        count: 生成数量

    Returns:
        list[Quiz] (已保存到数据库)
    """
    topics = _extract_topic_keywords(task.query)
    if not topics:
        topics = ["排序", "TCP", "进程"]  # 默认

    # 收集候选题目
    candidates = []
    for topic in topics:
        templates = _QUIZ_TEMPLATES.get(topic, {})
        for qtype, items in templates.items():
            for item in items:
                if difficulty == "easy":
                    weight = 3 if qtype == "judge" else (2 if qtype == "single" else 1)
                elif difficulty == "hard":
                    weight = 3 if qtype == "fill" else (2 if qtype == "single" else 1)
                else:
                    weight = 1
                candidates.append((item, qtype, weight))

    # 加权随机挑选
    random.shuffle(candidates)
    selected = []
    used_q = set()
    for item, qtype, _ in candidates:
        if len(selected) >= count:
            break
        if item["q"] in used_q:
            continue
        used_q.add(item["q"])
        selected.append((item, qtype))

    # 补充到 count 个
    while len(selected) < count:
        topic = random.choice(topics)
        templates = _QUIZ_TEMPLATES.get(topic, {})
        qtype = random.choice(list(templates.keys()))
        items = templates[qtype]
        item = random.choice(items)
        if item["q"] not in used_q:
            used_q.add(item["q"])
            selected.append((item, qtype))

    # 创建 Quiz 对象
    quizzes = []
    type_map = {"single": Quiz.Type.SINGLE, "judge": Quiz.Type.JUDGE, "fill": Quiz.Type.FILL}
    diff_map = {"easy": Quiz.Difficulty.EASY, "medium": Quiz.Difficulty.MEDIUM, "hard": Quiz.Difficulty.HARD}

    for idx, (item, qtype) in enumerate(selected):
        quiz = Quiz.objects.create(
            task=task,
            question_type=type_map.get(qtype, Quiz.Type.SINGLE),
            difficulty=diff_map.get(difficulty, Quiz.Difficulty.MEDIUM),
            content=item["q"],
            options=item.get("opts", []),
            correct_answer=item["ans"],
            explanation=item.get("exp", ""),
            score=10,
            order=idx + 1,
        )
        quizzes.append(quiz)

    return quizzes
