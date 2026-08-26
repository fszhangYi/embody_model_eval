---
name: dsh-agent-integration
description: >-
  Integrate embody_dsh_agent (DeepSeek Harness bridge) into another application's
  Agent/Chat page after cloning git@github.com:fszhangYi/embody_dsh_agent.git.
  Covers clone, venv, .env, link-skills, bridge_server, HTTP forwarding mode
  dsh_agent, sessionId, and skill symlink alignment. Use when the user asks to
  集成 embody_dsh_agent、对接 DSH bridge、Agent 页面接入工具循环、或从 GitHub
  克隆后接入评测/业务 Chat。
---

# dsh-agent-integration — 将 embody_dsh_agent 接入外部 Agent 页面

本 skill 描述 **标准集成流程**：从 Git 克隆 `embody_dsh_agent`，在本机跑 HTTP bridge，再在**另一个软件**的 Agent/Chat 页面增加 `dsh_agent` 转发模式。

参考实现：本仓库 `embody_model_eval`（`scripts/agent_server.py` + Chat 页）。

---

## When to use

- 用户要在业务系统 / 评测平台 / 自建 Chat 页里接入 **真实 Agent**（skill 工具 + bash + 改文件），而非单次 LLM 补全
- 用户提到 `embody_dsh_agent`、`DSH bridge`、`8790`、`dsh_agent` 模式
- 用户要从 `git@github.com:fszhangYi/embody_dsh_agent.git` 拉仓库并完成对接

## Architecture (one glance)

```text
[Host App Chat UI]
       │ POST /api/chat  { mode: "dsh_agent", message, skillIds, history, sessionId }
       ▼
[Host App Backend]  try_dsh_agent() — 拼装 message，HTTP 转发
       │ POST http://127.0.0.1:8790/agent/run
       ▼
[embody_dsh_agent]  bridge_server.py → DeepSeekHarness + cordis + .dsh/skills
       │ tool loop (skill / bash / editor)
       ▼
sessions/*.jsonl + 最终 reply 文本
```

**部署原则**：对外只暴露 Host App 端口；bridge 默认 `127.0.0.1:8790`，由后端转发，不必公网暴露 DSH。

---

## Phase 1 — 克隆与安装 embody_dsh_agent

### 1.1 Clone

```bash
git clone git@github.com:fszhangYi/embody_dsh_agent.git
cd embody_dsh_agent
```

SSH 不可用时可用 HTTPS：`https://github.com/fszhangYi/embody_dsh_agent.git`。

### 1.2 Python 环境

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -c "from deepseek_harness import DeepSeekHarness; print('SDK OK')"
```

### 1.3 API Key

```bash
cp .env.example .env
```

在 `.env` 中至少设置：

```bash
DEEPSEEK_API_KEY=sk-...
DSH_MODEL=deepseek-chat
```

可选：`DEEPSEEK_BASE_URL`、`DSH_CWD`（Agent 写文件目录）、`DSH_SESSION_ROOT`、`DSH_SYSTEM_PROMPT`。

**勿**将 `.env` 提交到 Git；**勿**在日志或 Chat 回执中打印 key。

### 1.4 链接 Skills（与 Host App 对齐）

本仓库 skill 目录为 **`agent_skills/`**。在 `embody_dsh_agent` 中执行：

```bash
bash scripts/link-skills.sh
```

该脚本默认链接 `../embody_model_eval/agent_skills`（相对路径）。若 Host 路径不同，编辑 `link-skills.sh` 中的源路径后再执行。

Host Chat 勾选的 skill **名称** 应与 `embody_dsh_agent/.dsh/skills/<name>` 一致。

### 1.5 验收（CLI）

```bash
source .venv/bin/activate
python scripts/run_agent.py "列出可用 skills 并简述 dsh-agent-integration 用途"
```

应得到非空回复，且能提及 skill 列表或本 skill 用途。

---

## Phase 2 — 启动 HTTP Bridge

```bash
source .venv/bin/activate
python scripts/bridge_server.py --host 127.0.0.1 --port 8790
```

探活：

```bash
curl -s http://127.0.0.1:8790/health
# 期望: {"ok":true,"service":"embody-dsh-agent"}
```

---

## Phase 3 — 在本仓库（embody_model_eval）中已实现的集成点

若对接目标是 **本评测平台 Chat**，通常无需改代码，按下列步骤即可：

1. 完成 Phase 1–2（DSH 仓库 clone、`.env`、bridge 运行）
2. 运行 `bash embody_dsh_agent/scripts/link-skills.sh`
3. 启动本仓库：`./serve.sh 6008`（或 `6006`）
4. 打开 `chat.html` → Agent 模式选 **`dsh_agent`**
5. Base URL：`http://127.0.0.1:8790`，Path：`/agent/run`

关键实现位置：

| 文件 | 作用 |
|------|------|
| `scripts/agent_server.py` | `try_dsh_agent()`、`mode == "dsh_agent"` 分支 |
| `frontend/src/features/chat/mountChat.ts` | 模式 UI、`localStorage` sessionId |
| `agent_skills/` | 本侧托管 skills（经 link-skills 同步到 DSH） |

环境变量：`DSH_BRIDGE_URL` 可覆盖默认 bridge 地址。

---

## Phase 4 — 接入其它 Host App（通用后端）

在 Host Chat 路由中增加模式 **`dsh_agent`**。

### Bridge API

| 方法 | 路径 | Body | 成功响应 |
|------|------|------|----------|
| `GET` | `/health` | — | `{"ok":true}` |
| `POST` | `/agent/run` | `{"message","sessionId?"}` | `{"ok":true,"reply","sessionId","finishReason"}` |

### 转发要点

1. URL：`baseUrl` + `/agent/run`（默认 `http://127.0.0.1:8790`）
2. timeout：**300s**
3. 拼装单条 `message`：勾选 skill 名称提示 + 最近 12 轮 history + 用户诉求
4. 传递 `sessionId` 以复用 Harness 会话
5. 返回 `reply` 与 `sessionId` 给前端

### 伪代码

见 `scripts/agent_server.py` 中 `try_dsh_agent()`（约 425–495 行）。

**注意**：`dsh_agent` 模式不要把 skill 全文再塞进 bridge；靠 `.dsh/skills` + `skill` 工具按需加载。`openai`/`dry_run` 模式才用 `build_messages()` 注入全文。

---

## Phase 5 — 通用前端

1. 模式选项 `dsh_agent`，默认 URL `http://127.0.0.1:8790`，path `/agent/run`
2. 发送时附带 `sessionId`（`localStorage` 键名可自定，本仓库用 `embody_dsh_session`）
3. 响应 `meta.sessionId` 写回 localStorage

参考：`frontend/src/features/chat/mountChat.ts` 中 `sendChat()`。

---

## Phase 6 — 验收清单

- [ ] `curl :8790/health` 成功
- [ ] Host `/api/chat` + `mode: dsh_agent` 有回复
- [ ] Chat 勾选 skill 后 Agent 能调用同名 skill
- [ ] 多轮对话 sessionId 稳定，`embody_dsh_agent/sessions/` 有 JSONL

---

## Troubleshooting

| 现象 | 处理 |
|------|------|
| 无法连接 bridge | 启动 `bridge_server.py` |
| `DEEPSEEK_API_KEY not set` | 配置 DSH `.env` |
| skill 未生效 | `link-skills.sh` + 检查同名目录 |
| 超时 | 后端 HTTP timeout ≥ 300s |

---

## Security

- DSH 默认 `danger-full-access` sandbox
- bridge 建议仅 `127.0.0.1`
- 勿泄露 API key

---

## Related

- `embody_dsh_agent/README.md`
- `embody_dsh_agent/docs/手把手教学笔记.md`
- 本仓库 `README.md` → AI Chat 章节
