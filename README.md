# Embody Model Eval

SO-100 六轴策略 / 模型的 **功能评测可视化**：在同一坐标系叠画 current · GT · predict，对照 TCP 与关节误差，用于检查模型「下一时刻位姿」是否合理。

- 全屏 Three.js（官方 mesh + 灰/红/蓝三份着色 URDF）
- TCP（指尖中点）xyz 轴 + 当前帧 ±15 散点
- 左侧：播放 / 显隐 / 画布录制（WebM）
- 右侧：概览、误差、关节轨迹、数值（可折叠）

浏览器加载本地 `vendor/` 中的 Three.js / Chart.js / urdf-loader，**不依赖 Node.js，也不依赖外网 CDN**；本仓库用 Python 标准库静态托管即可。

## 环境

| 项 | 说明 |
|----|------|
| Python | **3.12**（已在 3.12.13 验证） |
| 第三方包 | 托管页面无；见 `requirements.txt` |
| 浏览器 | 现代 Chromium / Firefox（录制需 `MediaRecorder` + WebM） |

```bash
python3 -V   # 建议 >= 3.10，推荐 3.12
```

## 目录结构

```
embody_model_eval/
├── index.html              # 评测主页面
├── hub.html
├── tcp_metrics.js          # TCP / 任务误差指标
├── export_report.js        # HTML/JSON 报告与门禁
├── favicon.svg / .ico / .png
├── compare_result.json     # 评测对比数据
├── vendor/                 # 离线前端依赖（Three / Chart.js / urdf-loader）
├── scripts/
│   ├── batch_score.py      # 批量跑分 + 门禁
│   ├── bag_to_compare.py   # 日志 → compare_result.json
│   └── thresholds.example.json
├── serve.sh
├── requirements.txt
├── README.md
└── so100_colored/          # 灰 / 红 / 蓝 URDF + STL
    ├── so100_cur.urdf
    ├── so100_gt.urdf
    ├── so100_pred.urdf
    └── assets/*.stl
```

目录自包含：着色 URDF 为独有资源，mesh 为从 SO-ARM100 复制的 STL（无软链）。

## 启动

```bash
cd /root/autodl-tmp/embody_model_eval
./serve.sh          # 默认 0.0.0.0:6006
# 或
./serve.sh 8080
# 或
python3 -m http.server 6006 --bind 0.0.0.0
```

本地：`http://127.0.0.1:6006/`  
AutoDL 若映射端口 6006，使用控制台公网地址。

## 评测数据

`compare_result.json`：

- `meta`：帧数、fps、mean/max L2、逐关节 MAE、来源
- `series`：整段曲线（Chart.js）
- `frames[]`：每帧 `current` / `next_gt` / `next_pred` / `err_l2` 等

重新生成模拟评测数据（可选，在 `act_robot` 中）：

```bash
python /root/autodl-tmp/act_robot/scripts/compare_pose_offline.py \
  --mode simulate --n-frames 120 \
  --out-dir /root/autodl-tmp/embody_model_eval
```

会覆盖本目录的 `compare_result.json`，并同步当前页面模板。

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
- **录制**：仅 Three.js 画布 → WebM；侧栏不进入录像
- **导出**：左侧「导出 / 门禁」可下载 HTML 报告或 `eval_summary.json`（供批量门禁）
- **TCP**：gripper 系指尖中点约 `(0, -0.1062, 0)`；任务误差需 `meta.goal_pose = {pos, quat, approach?}`
- **浏览器图标**：`favicon.svg` / `favicon.ico` / `favicon.png`（标签页与书签）

## 批量跑分与真机日志

```bash
# E22 / E23：批量评分 + 阈值门禁（exit 2 表示未过）
python3 scripts/batch_score.py . \
  --thresholds scripts/thresholds.example.json \
  --out-dir /tmp/embody_batch --fail-on-gate

# E24：JSONL / CSV 关节日志 → compare_result.json（再 ./serve.sh 回放）
python3 scripts/bag_to_compare.py run.jsonl -o compare_result.json \
  --fps 30 --action-mode absolute --title "bag replay"
```

TCP 门禁需先在页面导出 `eval_summary.json`（或同目录 sidecar），与 `compare_result.json` 放在一起后再跑 `batch_score.py`。

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
| C13 | 多 episode / 多任务汇总页；阈值达标率 | 🔶 单轨迹达标率已有；多 episode 汇总页未做 |
| C14 | 多模型 / 多 checkpoint 同页对比 | ❌ |
| C15 | `action_mode` 明示 + 单位校验 | 🔶 UI 已显示；单位/语义校验未做 |
| C16 | dataset / 策略 / ckpt / obs 等 meta 可导出 | 🔶 导出 JSON 已带部分 meta 字段；采集侧约定未强制 |
| C17 | 失败帧自动挑出 + 一键跳转 | ✅ Top‑K 最差帧（按 \(e_p\)） |

### D. 物理 / 安全合理性（具身特有）

| # | 项 | 状态 |
|---|----|------|
| D18 | 关节限位 / 奇异附近告警 | ❌ |
| D19 | 自碰 / 桌面碰撞粗检 | ❌ |
| D20 | 平滑性与可执行性（关节跳跃、超速占比） | ❌ |

### E. 工程与工作流

| # | 项 | 状态 |
|---|----|------|
| E21 | 一键导出报告（HTML + JSON 摘要；可选缩略图） | ✅ |
| E22 | 批量跑分 CLI → JSON/CSV（`scripts/batch_score.py`） | ✅ |
| E23 | 阈值门禁（页面 + CLI `--fail-on-gate`） | ✅ |
| E24 | 真机 / 遥操作日志回放（`scripts/bag_to_compare.py`：JSONL/CSV→评测 JSON） | ✅ 需先导出关节轨迹；不直接解析 ROS bag 二进制 |

**建议后续优先：** C14 多模型对比 → C13 多 episode 汇总 → D18 / D20 安全与可执行性告警。

## 更换机械臂

默认可视化机型是 **SO-100**（`so100_colored/` 下三份着色 URDF + STL）。换成其它臂时，除替换模型文件外，还必须让 **关节名、关节顺序、TCP、评测 JSON** 与页面代码一致，否则会出现「加载成功但姿态错 / TCP 飞掉 / 图表关节对不上」。

### 1. 替换模型资源

1. 准备新臂的 URDF（或 xacro 已展开的 `.urdf`）及 mesh（`.stl` / `.dae` 等）。
2. 复制出 **三份** URDF（或在同一 URDF 上改材质），分别给 current / GT / predict 着色，便于叠画区分，例如：
   - 灰（current）· 红（GT）· 蓝（predict）——与现有 `so100_cur|gt|pred.urdf` 一致即可。
3. 把新目录放到仓库根下（可改名，例如 `my_arm_colored/`），保证 URDF 内 `mesh filename="..."` 相对路径能找到 `assets/`。
4. 在 `index.html` 中改加载路径：

```js
const URDF_CUR = './my_arm_colored/xxx_cur.urdf';
const URDF_GT  = './my_arm_colored/xxx_gt.urdf';
const URDF_PRED = './my_arm_colored/xxx_pred.urdf';
```

加载文案（如「加载 3× SO-100 URDF…」）可顺手改成新机型名。

### 2. 必须同步修改的内容（清单）

| 位置 | 改什么 | 为何 |
|------|--------|------|
| `index.html` → `JOINTS` | 关节名数组，顺序与控制量一致 | `setPose` 按此名写 `robot.joints[name]` |
| `compare_result.json` → `meta.joint_names` | 与 `JOINTS` **同名、同序** | 右侧图表 / 数值面板依赖该字段 |
| `compare_result.json` → `frames[].current|next_gt|next_pred` | 每帧关节角数组长度与顺序 = `JOINTS` | 单位默认按 **度**（页面内 `* DEG2RAD`） |
| `compare_result.json` → `meta.per_joint_mae` / `series` | 键名或曲线通道与关节一致 | 概览 MAE、关节轨迹图 |
| `index.html` → `getTcpPose` / `TCP_OFFSET_GRIPPER` | TCP 所在 **link 名** + 指尖相对该 link 的偏移 | 默认 link=`gripper`，偏移 `(0, -0.1062, 0)`（米，gripper 系） |
| `index.html` → `loadRobot` 里 `robot.rotation.x` | 坐标系朝向（当前 `-π/2` 适配 SO-100） | 换臂后若模型躺倒/倒置，调此旋转或在 URDF 里改 root |
| 生成脚本（可选） | `act_robot/scripts/compare_pose_offline.py` 等 | 重新导出 JSON 时关节定义要与新臂一致 |
| `README.md` / 页面标题文案 | 机型名、TCP 说明、许可来源 | 文档与实际机型一致 |

关节自由度变化时（例如 7 轴），除改 `JOINTS` 外，还需保证 JSON 每帧数组长度、MAE 与 series 维度一并更新；自由度减少则删掉多余通道。

### 3. 建议自检

1. `./serve.sh` 打开页面，确认三色臂均加载、无 mesh 404。
2. 拖时间轴：灰/红/蓝姿态是否随 `current` / `next_gt` / `next_pred` 合理变化。
3. TCP 轴与散点是否落在末端执行器附近（不对则改 link 名或 `TCP_OFFSET_GRIPPER`）。
4. 右侧「关节」下拉与曲线名称是否等于新 `joint_names`。

### 4. 不必改的部分

- `vendor/`（Three.js / Chart.js / urdf-loader）
- 播放 / 显隐 / 录制等 UI 逻辑（与具体机型无关）
- `serve.sh` / 端口托管方式

## 许可与来源

- mesh / URDF 骨架：[TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)
- `so100_*.urdf` 仅改材质色以便叠画区分
- 浏览器图标为本仓库自绘资源（灰/红/蓝三臂示意）
