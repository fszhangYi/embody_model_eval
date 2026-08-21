# Embody Model Eval · 未完成功能清单（TODO）

更新：2026-08-21  
范围：架构必做项 **H–L**（A–G 已落地，详见 `README.md`）  
状态约定：❌ 未做 · 🔶 部分 · ✅ 已完成

---

## 建议落地优先级

```
L43 → H31 / H32 → J37 → I35 → K41
```

一句话：A–G 已覆盖「离线回放 + 感知/任务」；H 起要把评测接到**控制语义、多机型、闭环执行、可发布统计与协议合同化**。

---

## H. 动作空间与控制语义

现状：默认绝对关节角；有 `action_mode` 声明与启发式单位校验，**尚无多空间可执行换算与控/策误差分离**。

| # | 项 | 为何必须 | 状态 |
|---|----|----------|------|
| H31 | 正式支持多种 `action_mode` 的可执行换算（delta-q / EE Δpose / target pose） | 训练空间 ≠ 评测空间会导致系统性假失败 | ❌ |
| H32 | 控制器跟踪误差（命令 vs 实测）与策略误差分离 | 否则把低层伺服问题算到策略头上 | ❌ |
| H33 | 夹爪通道语义统一（开合量 / 宽度 mm / 二值） | 夹爪错义会直接毁掉抓取评测 | ❌ |

**落地线索**

- 在 `meta` / `frames` 中区分 `action`（策略输出）与 `state`（实测）
- 评测页增加「命令轨迹 vs 实测」曲线；Hub 聚合控跟踪指标
- 夹爪字段文档化并在 `robots.json` / schema 中约束

---

## I. 机型与运动学资产

现状：`robots.json` + 防呆已就位，但有效机型基本只有 **so100**；碰撞仍为球/平面粗检。

| # | 项 | 为何必须 | 状态 |
|---|----|----------|------|
| I34 | 第二、第三机型真实入库（URDF collision + 真限位 + 标定 TCP） | 没有第二机型谈不上多机型平台 | ❌ |
| I35 | 基于 URDF collision / 凸包的碰撞（替换球粗检） | 安全门禁否则不能上线 | ❌ |
| I36 | 手眼 / 基座位姿标定结果进 meta 并参与 TCP | 无标定则跨相机、跨安装无法复现 | ❌ |

**落地线索**

- 新增机型目录 + `robots.json` 条目（含 `joint_limits`、collision meshes）
- `advanced_cd.js` 碰撞从球距升级为 mesh/凸包抽样
- `meta.extrinsics` / `meta.tcp_calibration` 参与 TCP 世界系换算

---

## J. 闭环与在线评测

现状：离线「下一时刻」GT vs pred 比对；无整段闭环 rollout、无时延门禁、无 runner 接口。

| # | 项 | 为何必须 | 状态 |
|---|----|----------|------|
| J37 | 闭环 rollout 导入（整段策略执行轨迹，而非单步 next-pose） | 真实部署是闭环；开环一步误差会低估复合漂移 | ❌ |
| J38 | 推理时延 / 抖动 / 丢帧指标 | 实时系统不过门禁就不能上真机 | ❌ |
| J39 | 与仿真 / 真机 runner 的标准接口（发动作、收 obs、落盘） | 否则永远停在「看回放」，进不了 CI 训练闭环 | ❌ |

**落地线索**

- episode 增加 `rollout` 模式字段与整段 `executed` 轨迹
- `frames[i].timing`：`infer_ms` / `jitter_ms` / `dropped`
- 定义 HTTP/gRPC 或本地 socket 的 runner 契约 + 落盘为现有 JSON schema

---

## K. 统计与发布门禁

现状：有单条阈值门禁与 Hub 汇总表，缺置信区间、套件级发布看板与指纹。

| # | 项 | 为何必须 | 状态 |
|---|----|----------|------|
| K40 | 跨 episode 置信区间 / 显著性（bootstrap） | 小样本均值会骗人 | ❌ |
| K41 | 套件级门禁矩阵（按任务 × 机型 × 模型出 PASS/FAIL 看板） | Hub 有表，但还缺发布决策视图 | ❌ |
| K42 | 数据与报告指纹（schema 版本、git hash、权重 hash） | 复现与追责的底线 | ❌ |

**落地线索**

- Hub 新页或新区块：门禁矩阵 + CI 徽章式 PASS/FAIL
- `batch_score.py` / 导出报告写入 `fingerprint`
- bootstrap 置信区间进汇总 JSON 与图表误差棒

---

## L. 数据协议硬化

现状：字段持续扩展（obs / task / events），但尚无合同化 schema 与强约束套件清单；bag 仅 JSONL/CSV 间接导入。

| # | 项 | 为何必须 | 状态 |
|---|----|----------|------|
| L43 | `episode.schema.json` + 版本号 + 迁移脚本 | 多机型 / 多团队后没有 schema 会迅速腐化 | ❌ |
| L44 | 真 ROS bag / MCAP 直读（不止 JSONL/CSV） | 产线日志主流格式；现在差最后一公里 | ❌ |
| L45 | 套件清单强制字段（robot、task、split、seed、env） | 否则 Hub「多 episode」无法做成可比实验 | ❌ |

**落地线索**

- `schemas/episode.schema.json` + `meta.schema_version` + `scripts/migrate_episode.py`
- `bag_to_compare.py` 扩展 rosbags / mcap 读者
- `data/index.json` / suite manifest 校验强制字段；Hub 加载前硬失败

---

## 已完成（摘要，勿重复排期）

| 组 | 范围 | 说明 |
|----|------|------|
| A–E | 指标 / 可视化 / 协议 / 安全粗检 / 工程流 | 见 README「评测能力提升清单」 |
| F25–F27 | 观测同步、对齐协议、关键帧叠加 | `obs_align.js` + `media/` |
| G28–G30 | 任务成功、接触事件、物体位姿序列 | `task_events.js` + 演示数据 |

工程侧近期已落地、**不列入 H–L 必做**但仍可增强的项：

- 评测页快捷键（空格 / ←→ / R·T·S）
- 顶栏可扩展「页面」菜单（`nav_pages.js`）
- Hub 表格全宽
- 模型数据流演示画布（`pipeline.html`，ComfyUI 风格；训练/推理）

---

## 维护说明

1. 完成某项后：将本文件对应行改为 ✅，并同步更新 `README.md` 能力清单。  
2. 新增 tab / 能力：在 `nav_pages.js` 登记入口，并在本文件补编号（建议从 **M** 起）。  
3. 本文件只跟踪**未完成 / 部分完成**的架构必做项；日常 bug 用 issue 或 PR 描述即可。
