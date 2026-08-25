# Embody Model Eval

SO-100 六轴策略 / 模型的 **功能评测可视化**：在同一坐标系叠画 current · GT · predict，对照 TCP 与关节误差，用于检查模型「下一时刻位姿」是否合理。

- 全屏 Three.js（官方 mesh + 灰/红/蓝三份着色 URDF）
- TCP（指尖中点）xyz 轴 + 当前帧 ±15 散点
- 左侧：播放 / 显隐 / 观测相机同步 (F) / 画布录制（WebM）
- 右侧：概览、误差、关节轨迹、任务/接触 (G)、数值（可折叠）
- Hub：多 episode 汇总，含 obs / 任务列与机型防呆；顶栏「页面」菜单可扩展更多 tab（Alt+1…N / Alt+←→ 切换）
- 机械臂 3D：`robots.html` 下拉选择 `config/robots.json` 中的机型并浏览 URDF（当前含 SO-100 / EC616 / Koch）
- 数据流：`pipeline.html` ComfyUI 风格画布，演示 ACT/SAM2 训练与推理张量流向
- AI Chat：`chat.html` 选择托管 Skill、配置 Agent 链接，将诉求与 skill 一并发送并显示回执
- 传感器状态：`/sensors` 卡片墙（机械臂 / 夹爪 / 触觉 / RealSense / 六维力 / Gello）；机械臂已内置 `arm_kin` 运动学（原独立 `demo_test` 已合并），双击可测 FK/IK 并查看搭建说明

浏览器加载本地 `vendor/` 中的 Three.js / Chart.js / urdf-loader，**不依赖 Node.js，也不依赖外网 CDN**；本仓库用 Python 标准库托管静态页，并由同一进程提供 `/api/*`（skills / chat / sensors）与 **Cookie 登录鉴权**。

## 环境

| 项 | 说明 |
|----|------|
| Python | **3.12**（已在 3.12.13 验证） |
| 第三方包 | 托管页面无；见 `requirements.txt` |
| 浏览器 | 现代 Chromium / Firefox（录制需 `MediaRecorder` + WebM） |
| 鉴权 | 默认开启；登录页 `/login`；可用环境变量或 `config/.auth.json` 配置 |

```bash
python3 -V   # 建议 >= 3.10，推荐 3.12
```

## 目录结构

```
embody_model_eval/
├── index.html · hub.html · pipeline.html · chat.html · robots.html   # 页面入口（根路径不变）
├── serve.sh · requirements.txt · README.md
├── js/                     # 前端模块
│   ├── nav_pages.js · view_tools.js · robots_registry.js
│   ├── tcp_metrics.js · obs_align.js · task_events.js
│   ├── export_report.js · advanced_cd.js
│   ├── chat.js · robots_view.js · pipeline_flow.js
├── css/
│   └── ui_motion.css       # 全站动效
├── assets/                 # favicon.svg / .ico / .png
├── config/
│   ├── robots.json         # 机型注册表
│   ├── auth.example.json   # 鉴权配置示例 → 复制为 .auth.json
│   └── episodes.manifest.example.json
├── models/                 # URDF + mesh
│   ├── so100_colored/      # SO-100 灰/红/蓝
│   └── ec616/              # EC616 + 平行夹爪
├── data/                   # 比对数据（按套件分子目录）
│   ├── index.json          # 启动时由 serve.sh 实时刷新
│   ├── 20260819/ · 20260405/ · short/
│   └── ec616_short/ · ec616/
├── arm_kin/                # 内置六轴 FK/IK（原 demo_test）
├── vendor/                 # 离线 Three / Chart.js / urdf-loader
├── scripts/                # Python 工具与 agent_server
│   ├── agent_server.py     # 静态托管 + /api/* + 鉴权
│   ├── auth.py             # Cookie 会话鉴权
│   ├── arm_kinematics.py · arm_kin_bridge.py
│   ├── batch_score.py · bag_to_compare.py · refresh_data_index.py
│   ├── gen_sim_episodes.py · gen_obs_media.py · gen_task_demo.py
│   └── thresholds.example.json
├── frontend/               # React SPA（/ 总览 · /eval 评测 · /login · /sensors …）
├── agent_skills/           # Chat 托管 Skills
└── docs/
    └── TODOLIST.md
```

页面入口仍在仓库根目录，便于 `./serve.sh` 后直接打开 `/`、`/hub.html` 等；脚本与资源按职责分目录。

## 启动

```bash
cd /root/autodl-tmp/embody_model_eval
./serve.sh          # 默认 0.0.0.0:6006
# 或
./serve.sh 8080
# 或
python3 -m http.server 6006 --bind 0.0.0.0
```

本地：`http://127.0.0.1:6006/`（首次会跳转 `/login`；登录后进入项目总览 `/`，单轨迹评测为 `/eval`）

### 鉴权

默认开启 Cookie 会话鉴权（保护 `/api/*` 与 `/data` · `/config` · `/models` · `/agent_skills`）。

| 方式 | 说明 |
|------|------|
| 首次启动 | 自动生成 `config/.auth.json`，并在终端打印用户名/密码 |
| 环境变量 | `EMBODY_AUTH_USER` / `EMBODY_AUTH_PASSWORD` |
| 配置文件 | 复制 `config/auth.example.json` → `config/.auth.json` |
| 关闭鉴权 | `EMBODY_AUTH_DISABLED=1 ./serve.sh` |

登录页布局仿 GitHub（居中卡片 + 品牌标识），视觉沿用站内深色青绿主题。页面菜单可「退出登录」。AutoDL 若映射端口 6006，使用控制台公网地址。

> 仅静态浏览可用 `python3 -m http.server`；**AI Chat / skills API** 需要 `./serve.sh`（即 `scripts/agent_server.py`）。

## AI Chat（Skills + Agent 链接）

打开 `chat.html`（顶栏「页面」→ Chat）：

1. **托管 Skills**：服务端目录 `agent_skills/`；左侧列出可导入的本机 skill，一键导入；点击 skill 名称可预览 `SKILL.md`
2. **勾选 skill** 后填写诉求（可用模板芯片）；**多轮对话**会自动带上本页上文
3. **回执操作**：复制全文 / 复制 dry_run 打包 JSON / 导出单条或整段 Markdown
4. **Agent 链接模式**
   - `dry_run`：不调外部，返回打包回执（默认，便于联调）
   - `openai`：兼容 `/chat/completions` 网关（提交完整 messages，含历史）
   - `webhook`：向自定义 URL POST `{ message, history, skills, messages }`
   - `cursor_sdk`：可选 `pip install cursor-sdk`，用 API Key 跑本地 Agent（选中 skill 写入临时 project skills）
   - `dsh_agent`：转发到本机 `embody_dsh_agent` 桥接（默认 `http://127.0.0.1:8790/agent/run`），支持 Skill 工具循环 / bash / 改文件

配置保存在 `agent_skills/.agent_config.json`（已 gitignore）；也可用环境变量 `CURSOR_API_KEY` / `AGENT_API_KEY`。`dsh_agent` 也可设 `DSH_BRIDGE_URL`。会话历史仅存本机 `localStorage`，不与其它页面耦合。

> 公网只开一个端口时：评测服务监听 `6008`，dsh bridge 监听本机 `127.0.0.1:8790`，由 Chat 服务端转发。

## 评测数据

比对 JSON 放在 **`data/<套件名>/`** 下，例如：

- `data/20260819/episode_1.json` …
- `data/20260405/episode_1.json` …

每个文件需含：

- `meta.robot`：**必填**，机械臂型号 id（须在 `config/robots.json` 登记，当前为 `so100` / `ec616`）
- `meta` + 非空 `frames[]`（帧内 `current` / `next_gt` / `next_pred` 关节角）

字段说明：

- `meta.robot`：机型 id → 决定加载哪套 URDF / 关节名 / TCP
- `meta`：帧数、fps、mean/max L2、逐关节 MAE、来源
- `series`：整段曲线（Chart.js）
- `frames[]`：每帧 `current` / `next_gt` / `next_pred` / `err_l2` 等

## 机械臂型号（多机型扩展）

可用机型集中登记在 **`config/robots.json`**（当前：**so100** / **ec616** / **koch**）。每条 episode 必须声明：

```json
"meta": { "robot": "so100", ... }
```

页面启动时：

1. 读取 `config/robots.json`
2. 用 `meta.robot` 解析机型（URDF、`joint_names`、`joint_limits`、collision、TCP link/offset/标定、root 旋转）
3. 自动加载对应模型；若 id 未登记或缺失则报错

可选标定（参与 TCP 世界系，I36）：

```json
"meta": {
  "robot": "so100",
  "tcp_calibration": { "xyz": [0, -0.002, 0], "rpy_deg": [0, 0, 0] },
  "extrinsics": { "base_in_world": { "xyz": [0, 0, 0], "rpy_deg": [0, 0, 0] } }
}
```

新增机型时：

1. 准备三份着色 URDF + mesh，放入 `models/` 下独立目录（参考 `models/so100_colored/`）
2. 在 `config/robots.json` 增加条目：`joint_limits`（度）、`collision`（hull 采样 link 链）、`tcp.calibration`
3. 生成或转换数据时写上 `"meta": { "robot": "<新id>" }`

- **单轨迹页**默认加载 `./data/20260819/episode_1.json`；可用 `?data=./data/<suite>/xxx.json` 指定。
- **Hub**（`hub.html`）选框列出 `data/` 子目录；选中后加载该目录下全部合法 JSON（须含 `meta.robot`）。
- **`./serve.sh` 启动前**会执行 `scripts/refresh_data_index.py`，实时重写 `data/index.json`。
- 批量生成模拟数据：

```bash
python3 scripts/gen_sim_episodes.py --short          # SO-100 5–10 帧短轨迹（默认附带 obs+任务）
python3 scripts/gen_sim_episodes.py --ec616          # EC616：ec616_short/ + ec616/（8 关节+平行夹爪）
python3 scripts/gen_sim_episodes.py --preset --with-obs
python3 scripts/gen_obs_media.py --all               # 仅为已有 episode 补观测媒体
python3 scripts/gen_task_demo.py --all               # 仅为已有 episode 补任务/接触/物体 (G)
# 或指定套件 / 机型：
python3 scripts/gen_sim_episodes.py --suite 20260819 --start 6 --count 3 --n-frames 8 --robot so100 --overwrite --with-obs
python3 scripts/gen_sim_episodes.py --suite ec616 --start 5 --count 2 --n-frames 40 --robot ec616 --overwrite --with-obs
```

Hub 选 `ec616_short` / `ec616`；单轨迹示例：`/eval?data=./data/ec616_short/episode_1.json`

重新生成模拟评测数据（可选，在 `act_robot` 中）：

```bash
python /root/autodl-tmp/act_robot/scripts/compare_pose_offline.py \
  --mode simulate --n-frames 120 \
  --out-dir /root/autodl-tmp/embody_model_eval/data/20260819
```

若脚本仍输出 `compare_result.json`，请改名为 `episode_N.json`，并补上 `meta.robot` 后放入对应套件目录。

## 离线说明

`vendor/` 已内置固定版本前端库，断网也可打开页面。目标机只需任意 **Python 3.8+**（推荐 3.10/3.12）执行 `./serve.sh`，无需 pip 安装。

| 库 | 版本 |
|----|------|
| three | 0.160.0 |
| chart.js | 4.4.1 |
| urdf-loader | 0.12.5 |

## 使用提示

- **显隐**：灰 / 红 / 蓝对应 current / GT / predict
- **速度**：默认约 `0.2×`（相对数据 fps）
- **快捷键（评测页）**：空格 播放/暂停 · ←/→ 切帧 · Home 重置 · R 开始录制 · T 停止 · S 保存
- **页面入口**：顶栏「页面」下拉（`nav_pages.js`）；含评测 / Hub / **模型数据流** / Chat / **机械臂 3D**
- **机械臂 3D**：`robots.html` — 下拉选 SO-100 / EC616，拖拽旋转、关节滑条、home / 零位
- **数据流画布**：`pipeline.html` — 下拉选 SAM2Grasp / 纯 ACT(CVAE)，再切训练·推理；可拖拽、流动演示与画布录像（WebM）
- **录制**：评测页录 Three.js 画布；数据流页合成录制节点图（连线 + 节点）→ WebM；侧栏说明不进入录像
- **导出**：左侧「导出 / 门禁」可下载 HTML 报告或 `eval_summary.json`（供批量门禁）
- **观测 (F)**：左侧「观测相机 (F)」与帧滑条/播放同步；Hub Episode 表有 `obs` 列
- **任务 (G)**：右侧「任务 / 接触 (G)」看 success/fail、力事件与动态物体；Hub 有「任务」列
- **TCP**：gripper 系指尖中点约 `(0, -0.1062, 0)`；任务误差需 `meta.goal_pose = {pos, quat, approach?}`
- **浏览器图标**：`assets/favicon.svg` / `.ico` / `.png`（标签页与书签）

## 批量跑分与真机日志

```bash
# E22 / E23：批量评分 + 阈值门禁（exit 2 表示未过）
python3 scripts/batch_score.py . \
  --thresholds scripts/thresholds.example.json \
  --out-dir /tmp/embody_batch --fail-on-gate

# E24：JSONL / CSV 关节日志 → episode JSON（再 ./serve.sh 回放）
python3 scripts/bag_to_compare.py run.jsonl -o data/test1/episode_2.json \
  --fps 30 --action-mode absolute --title "bag replay"
```

TCP 门禁需先在页面导出 `eval_summary.json`（或同目录 sidecar），与 episode JSON 放在一起后再跑 `batch_score.py`。

## 评测能力提升清单（A–E）

面向具身策略评测的增强项与落地状态（✅ 已落地 / 🔶 部分 / ❌ 未做）。

### A. 指标层（pred vs GT 的 TCP 差异）

| # | 项 | 状态 |
|---|----|------|
| A1 | TCP 位姿误差 \(e_p\) / \(e_R\)，mean / p95 / max | ✅ |
| A2 | 分轴 TCP 误差 Δxyz 与 Δrpy | ✅ |
| A3 | 时间对齐：DTW / 最佳滞后 | ✅ |
| A4 | 速度 / 加速度一致性（线速度、角速度、加速度误差） | ✅ |
| A5 | 末端任务误差（`meta.goal_pose`：位置 / 姿态 / 接近向量，含末帧） | ✅ |
| A6 | 按接近 / 接触 / 搬运 / 回撤路径等长分段统计 | ✅ |

### B. 可视化层（把「差在哪」一眼看清）

| # | 项 | 状态 |
|---|----|------|
| B7 | TCP 误差矢量（GT→pred，可开关） | ✅ |
| B8 | 整段 TCP 轨迹对比（按 \(e_p\) 着色，可开关） | ✅ |
| B9 | 误差热力时间轴 + 点击跳帧 | ✅ |
| B10 | 关节→TCP 贡献分解（‖JᵢΔqᵢ‖） | ✅ |
| B11 | 工作空间俯视 XY（颜色=\(e_p\)，点击跳帧） | ✅ |
| B12 | 相机预设：侧视 / 顶视 / 跟随 TCP | ✅ |

### C. 评测协议与数据层（可复现、可对比）

| # | 项 | 状态 |
|---|----|------|
| C13 | 多 episode / 多任务汇总页；阈值达标率 | ✅ `hub.html` 按 `data/<suite>` 加载；单页达标率亦有 |
| C14 | 多模型 / 多 checkpoint 同页对比 | ✅ Hub 按 model 聚合对比表 |
| C15 | `action_mode` 明示 + 单位校验 | ✅ 启发式 deg/rad 与 mode 告警 |
| C16 | dataset / 策略 / ckpt / obs 等 meta 可导出 | ✅ 页面 provenance + 导出 JSON 字段 |
| C17 | 失败帧自动挑出 + 一键跳转 | ✅ Top‑K + 失败分类（e_p / e_R / 抖动） |

### D. 物理 / 安全合理性（具身特有）

| # | 项 | 状态 |
|---|----|------|
| D18 | 关节限位 / 奇异附近告警 | ✅ 限位越界 + 可操作度抽样 |
| D19 | 自碰 / 桌面碰撞（URDF collision 点云） | ✅ `collision_geom.js` hull 采样；回退球心距 |
| D20 | 平滑性与可执行性（关节跳跃、超速占比） | ✅ |

> C/D 为高级功能：逻辑在 `advanced_cd.js`，汇总页 `hub.html`。

### E. 工程与工作流

| # | 项 | 状态 |
|---|----|------|
| E21 | 一键导出报告（HTML + JSON 摘要；可选缩略图） | ✅ |
| E22 | 批量跑分 CLI → JSON/CSV（`scripts/batch_score.py`） | ✅ |
| E23 | 阈值门禁（页面 + CLI `--fail-on-gate`） | ✅ |
| E24 | 真机 / 遥操作日志回放（`scripts/bag_to_compare.py`：JSONL/CSV→评测 JSON） | ✅ 需先导出关节轨迹；不直接解析 ROS bag 二进制 |

### F. 观测与多模态对齐

| # | 项 | 状态 |
|---|----|------|
| F25 | 同步回放相机（RGB/Depth）与关节/TCP | ✅ 左侧「观测相机 (F)」；各套件 `media/` 含 demo |
| F26 | `obs` 时间戳对齐协议（frame ↔ image ↔ action） | ✅ `meta.obs_alignment` + `obs_align.js` 审计 / skew |
| F27 | 关键帧叠加投影（目标框 / 深度 / 注意力） | ✅ `overlays`: box / keypoints / heatmap |

**协议字段**

- `meta.cameras[]`：声明流（`id` / `stream`: rgb|depth|attention / 分辨率）
- `meta.obs_alignment`：`mode` = `frame_index` | `nearest_timestamp`，`max_skew_ms`，`action_time_field`（默认 `timestamp`）
- `frames[i].obs[camId]`：`{ path, t?, overlays? }`；`overlays` 支持 `box` / `keypoints` / `heatmap`

**如何在页面上看到**

| 项 | 操作 / 现象 |
|----|-------------|
| F25 | 打开任意套件 episode → 左侧「观测相机 (F)」→ 拖帧或播放：图像与 3D 关节/TCP **同帧切换**；可切 `wrist` / `front` / `wrist_depth` |
| F26 | 面板顶部显示对齐审计（`mode` / `max_skew`）；画布角标与底部 hint 显示 `skew ±ms`；演示数据在 **wrist 末两帧** 故意约 +80ms，超 50ms 阈值会出现 `skew` 告警 |
| F27 | 勾选「目标框 / 关键点 / 注意力」在 RGB 上叠加；depth 流为灰度深度图 |

逻辑在 `obs_align.js`；补媒体：`python3 scripts/gen_obs_media.py --all`（`--short` 生成模拟数据时默认附带）。

### G. 任务成功与接触事件

| # | 项 | 状态 |
|---|----|------|
| G28 | 任务成功标签（grasp/place/success/fail + 原因码） | ✅ `meta.task_outcome` + 右侧「任务 / 接触 (G)」 |
| G29 | 接触/力事件流（接触时刻、夹紧力、滑移） | ✅ `events[]` + `frames[].contact` + 力/滑移曲线 |
| G30 | 物体/夹取目标位姿序列（不只静态 `goal_pose`） | ✅ `frames[].objects` / 抓取后才移动；接近段物体静止 |

**协议字段**

- G28：`meta.task_outcome = { task, outcome, labels[], reason_code, reason, score, judged_at_frame }`
- G29：`events[{ frame|t, type, force_n?, slip_mm?, width_mm?, object? }]`；可选稠密 `frames[i].contact`
- G30：`meta.objects[]`；`frames[i].objects[id] = { pos, quat?, grasp? }`；演示数据中物体在抓取前保持桌面静止，臂从 home→approach→grasp 靠近

**演示数据约定（`gen_task_demo.py`）**

- 物体：抓取前固定在桌面；仅抬升 / 放置 / 滑落阶段才离开原位。
- 机械臂：重写关节轨迹为 home → approach → grasp → lift → place（或 miss/slip 分支），pred 相对 GT 带小滞后。
- 事件：含 `approach` / `contact_start` / `grasp_force` / `lift` / `place` / `slip` / `miss_grasp` 等，可点击跳帧。
- 与 F 共存：脚本只改关节与任务字段，保留已有 `frames[].obs` / `media/`。

**如何在页面上看到**

| 项 | 操作 / 现象 |
|----|-------------|
| G28 | 右侧「任务 / 接触 (G)」顶部标签：`success`/`fail`/`partial` + 原因码；Hub「任务」列汇总 |
| G29 | 事件列表可点击跳帧（含 `approach` / `contact_start` / `slip`…）；力/滑移曲线 |
| G30 | 播放前半段：黄球不动、臂靠近；抓取抬升后物体才随任务移动；绿点为固定 grasp 目标 |

补演示：`python3 scripts/gen_task_demo.py --all`。

**建议后续优先：** 用真实多 episode manifest 填满 Hub；H 类动作空间换算与控/策误差分离（见 `docs/TODOLIST.md`）。

### I. 机型与运动学资产

| # | 项 | 状态 |
|---|----|------|
| I34 | 多机型入库（URDF 限位 + collision + 标定 TCP） | ✅ so100 / ec616 / koch（各自独立 mesh）；`joint_limits` + `collision` + `tcp.calibration` |
| I35 | URDF collision / 凸包点云碰撞 | ✅ 替换纯球粗检；阈值在 `robots.json` |
| I36 | 手眼 / 基座位姿标定进 meta 并参与 TCP | ✅ `meta.tcp_calibration` + `meta.extrinsics.base_in_world` |

## 更换 / 新增机械臂

机型不再写死在 `index.html`，而是登记在 **`config/robots.json`**，由 episode 的 **`meta.robot`** 自动选用。

### 1. 准备模型资源

1. 准备新臂的 URDF（或已展开的 `.urdf`）及 mesh。
2. 复制出 **三份** URDF（或改材质），分别给 current / GT / predict 着色（灰 / 红 / 蓝）。
3. 放到 `models/` 下独立目录（如 `models/my_arm_colored/`），保证 URDF 内 mesh 相对路径正确。

### 2. 登记到 `config/robots.json`

在 `robots.robots` 增加一条，例如：

```json
"my_arm": {
  "id": "my_arm",
  "label": "My Arm",
  "joint_names": ["j1", "j2", "..."],
  "urdf": {
    "cur": "./models/my_arm_colored/xxx_cur.urdf",
    "gt": "./models/my_arm_colored/xxx_gt.urdf",
    "pred": "./models/my_arm_colored/xxx_pred.urdf"
  },
  "root_rotation_euler_xyz_deg": [-90, 0, 0],
  "tcp": { "link": "gripper", "offset": [0, -0.1062, 0] }
}
```

### 3. 数据侧必填

| 位置 | 改什么 |
|------|--------|
| episode JSON → `meta.robot` | 填 `config/robots.json` 中的 id |
| episode JSON → `meta.joint_names` | 与该机型 `joint_names` **同名、同序** |
| `frames[].current|next_gt|next_pred` | 长度与顺序 = 该机型关节数（默认单位：度） |

### 4. 建议自检

1. `./serve.sh` 打开带新 `meta.robot` 的 episode，确认三色臂加载且无 mesh 404。
2. 拖时间轴：姿态是否随数据合理变化。
3. TCP 轴是否落在末端附近（不对则改 `tcp.link` / `tcp.offset`）。
4. Hub 的「机型」列是否显示新 id。

### 5. 不必改的部分

- `vendor/`、播放 / 显隐 / 录制等与机型无关的 UI
- `serve.sh` / 端口托管方式

## 许可与来源

- mesh / URDF 骨架：[TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)
- `so100_*.urdf` 仅改材质色以便叠画区分
- 浏览器图标为本仓库自绘资源（灰/红/蓝三臂示意）
