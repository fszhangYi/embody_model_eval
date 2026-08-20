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
├── compare_result.json     # 评测对比数据
├── vendor/                 # 离线前端依赖（Three / Chart.js / urdf-loader）
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
- **TCP**：gripper 系指尖中点约 `(0, -0.1062, 0)`

## 许可与来源

- mesh / URDF 骨架：[TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)
- `so100_*.urdf` 仅改材质色以便叠画区分
