# 栈知映 · 技能树

把一条学习路线变成一棵会生长的技能树 —— 前端 / 后端 / 算法 / AI Agent 四个方向的技能依赖图可视化。

## 快速开始

零依赖,无需 npm install,直接用 Node(>=18)启动:

    node server.js
    # 或
    npm start

浏览器打开 http://localhost:3000/skilltree.html

## 功能

- 4 个方向:前端(42 节点)/ 后端(42 节点)/ 算法(40 节点)/ AI Agent(40 节点),共 164 节点 / 202 条依赖边
- 自动分层布局(拓扑排序 + 最长路径 + barycenter 层内排序)
- 四色学习状态:未学习 / 当前 / 完成 / 掌握
- 缩放平移、点击查看详情、底部总进度条
- 每个节点含严格的学习目标、关键概念与通过标准

## 目录结构

    skilltree-app/
    ├── server.js          # 精简后端(零依赖静态服务器)
    ├── skilltree.html     # 前端页面
    ├── skilltree-data.js  # 技能树数据(可自行扩充/替换)
    ├── package.json
    └── README.md

## 自定义技能树

编辑 skilltree-data.js,按 N(...) / E(...) 格式增删节点与依赖边即可,无需改任何界面代码。

- N(id, title, icon, category, depth, recommended_depth, status, order, 学习目标[], 关键概念[], 通过标准[])
- E(source, target) 表示「先学 source 再学 target」的前置依赖

## 端口

默认 3000,可用环境变量覆盖:

    PORT=8080 node server.js
