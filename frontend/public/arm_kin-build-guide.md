# arm_kin 机械臂正逆解项目 — 构建思路与集成参考

> 本文基于对 `embody_model_eval/arm_kin` 源码、`robot.xml`、测试与依赖的逐项分析整理。  
> 用途：后续把本项目集成进评测平台 / 实机控制 / 传感器页面前，作为「物料清单 → 库选型 → 模块拼装 → 正确性验收」的统一说明书。

---

## 1. 项目定位与边界

### 1.1 它是什么

`arm_kin` 是一套 **六轴偏置腕（ManipulatorType=1）机械臂运动学模板工程**，当前参数面向 **EA66 / EC616 同类构型**（`robot.xml` 中型号写为 `EA66`）。

核心能力：

| 能力 | 实现位置 | 说明 |
|------|----------|------|
| 正运动学 FK | `fk.py` + `dh.py` | 标准 DH 链乘，输出法兰 / TCP 齐次矩阵 |
| 数值逆运动学 IK | `ik.py` | SciPy `least_squares`，SE(3) 六维残差 |
| 参数配置 | `constants.py` / `robot.xml` | 常量默认值 + 厂商 XML 解析双通道 |
| 示教语义 | `teach.py` | 软限位、示教位姿 → 4×4、安装角 |
| 工业兼容层 | `rmp.py` | 历史 RMP/DLL 风格 API 的纯 Python 替代 |
| 回归测试 | `tests/test.py` | FK 对表、IK 回环、XML/RMP/P2P |

### 1.2 它不是什么（集成时勿误用）

- **不是** URDF / MuJoCo / Pinocchio 全栈仿真；`robot.xml` 是厂商 `RobotTemplate` 格式，不是标准 URDF。
- **不是** 解析解 IK（无闭式多解展开）；当前只填 RMP 缓冲的 **第一组数值解**。
- **不是** 碰撞检测 / 环境凸包 / 动力学；`rmp_set_env` 为占位（恒返回 0）。
- **不是** 实机驱动；不包含 EtherCAT、控制器 SDK、ROS 节点。
- **当前仅支持** `ManipulatorType == 1`（六轴偏置腕）；其它类型会直接 `ValueError`。

### 1.3 工程组织原则（为何这样拆）

原始算法曾集中在单体 `robot_fk.py`。现结构刻意做成：

```text
数据模型 → 常量事实 → 示教语义 → DH 数学核 → 配置组装
       → FK API → IK 求解 → XML 装载 → RMP 兼容壳 → 对外聚合入口
```

原则：

1. **常量与算法分离**：改连杆/限位只动 `constants.py` 或 XML，不动求解器。
2. **入口与实现分离**：业务侧优先 `from arm_kin import …` 或 `robot_fk`，不直接依赖内部实现细节（除诊断）。
3. **单位显式**：接口注释与命名强制区分 `deg/rad`、`mm/m`。
4. **可测**：示教标定点写入常量，测试可离线跑通，不依赖实机。

---

## 2. 目录与模块依赖

### 2.1 推荐目录骨架

```text
arm_kin/
  pyproject.toml          # 包元数据、依赖、setuptools src 布局
  requirements.txt        # 扁平依赖列表（与 pyproject 对齐）
  robot.xml               # 厂商机械臂模板（几何 + 限位）
  README.md
  构建思路.md             # 本文
  src/
    arm_kin/
      __init__.py         # from .robot_fk import *
      model.py            # 纯数据结构
      constants.py        # 全部硬编码事实
      teach.py            # 示教器语义
      dh.py               # DH 数学核
      config.py           # KinematicConfig 构建与缓存
      fk.py               # 正运动学 API
      ik.py               # 数值逆运动学
      robot_xml.py        # robot.xml → 配置
      rmp.py              # RMP/DLL 兼容类
      robot_fk.py         # 对外聚合 + __main__ 自检
  tests/
    test.py               # 全量回归
```

### 2.2 模块依赖关系（集成时勿形成环）

```text
model.py          （无内部依赖，最底层）
constants.py      → model
teach.py          → constants, scipy.spatial.transform
dh.py             → constants, model
config.py         → constants, dh, model, teach
fk.py             → config, dh, model
ik.py             → config, dh, model, teach, scipy.optimize
robot_xml.py      → config, constants, dh, model, teach, xml.etree
rmp.py            → config, constants, dh, ik, model, robot_xml
robot_fk.py       → 上述全部（仅聚合）
__init__.py       → robot_fk
tests/test.py     → arm_kin.robot_fk
```

**集成建议**：上层业务只依赖 `robot_fk` / 包级导出；需要换机型时改 `constants` + `robot.xml`，不要改 FK/IK 公式层。

---

## 3. 准备哪些物料（集成前 checklist）

按优先级分三档。缺「必需」则无法正确 FK/IK；缺「校准」则无法证明与现场一致。

### 3.1 必需物料（最小可运行）

| 物料 | 单位 / 格式 | 落点 | 如何取得 |
|------|-------------|------|----------|
| 6 个连杆关键长度 | mm，长度 6 | `LINK_LENGTH_MM` 或 XML `LinkLength_1..6` | 厂家手册 / 标定 / 现有 `robot.xml` |
| 机构类型 | int，必须为 `1` | `MANIPULATOR_TYPE` / `ManipulatorType` | 确认是六轴偏置腕 |
| 关节零位偏置 | deg × 6 | `JOINT_OFFSET_DEG` / `JointOffset_*` | 编码器零点相对 DH 零位 |
| 关节方向 | ±1 × 6 | `JOINT_DIRECTION` / `JointDirection_*` | 电机正转 vs DH 正方向 |
| 基坐标系轴向枚举 | int | `BASE_CS_X` / `BASE_CS_Z` | 与控制器约定一致（见 §3.4） |
| FK 输入关节角样本 | deg × 6 | 调用参数 | 控制器 / 示教器读数 |
| IK 目标位姿 | 4×4，平移 **m** | `T_desired` | 由任务规划或 FK 生成 |
| IK 初值 | deg × 6 | `q_seed_deg` | 当前关节角或邻近解 |

当前仓库已内置一套可运行默认值（与 `robot.xml` 对齐），可直接 `pip install -e` 后跑测。

### 3.2 强烈建议物料（校准与回归）

| 物料 | 说明 | 落点 |
|------|------|------|
| 示教器标定点 ≥ 3～9 组 | 每组：关节角 deg、法兰 xyz mm、姿态 RX/RY/RZ deg | `TEACH_PENDANT_POSES` |
| 关节软限位 | 比硬限位略紧，IK 边界用 | `TEACH_JOINT_SOFT_MIN/MAX_DEG` |
| 关节速度 / 加速度上限 | P2P 时间标定用 | 常量或 XML `JointVelocityMax_*` / `JointAccelerationMax_*` |
| 安装角 | 地板安装水平转角、倾斜 | `TEACH_INSTALL_ROT_Z1_DEG`、`TEACH_INSTALL_ROT_XB_Q1_DEG` |
| 完整 `robot.xml` | 与现场机型一致的一份 | 项目根目录 `robot.xml` |

示教点采集要点：

1. 在示教器上记录 **同一时刻** 的关节角与法兰位姿（避免运动中采样）。
2. 覆盖工作空间不同象限；至少包含腕部姿态变化大的点（本仓库点 7～9）。
3. 明确欧拉角约定（本项目默认 **固定 XYZ / `euler_seq="XYZ"`**）；若控制器是 ZYX，转换时必须改 `teach_flange_T_m_from_pendant(..., euler_seq=...)`。

### 3.3 可选物料（后续扩展，当前代码未强依赖）

| 物料 | 现状 |
|------|------|
| STL 可视化模型（XML 中 `Model_1..7`） | XML 有字段，Python **未解析、未渲染** |
| 连杆凸包长宽 | XML 有，**未用于碰撞** |
| 工具坐标系枚举 `ToolCsX/Z` | XML 有，**未接入**；工具靠 `T_flange_tool` 显式设置 |
| 笛卡尔速度 / 姿态速度上限 | 常量已写，**P2P 未使用笛卡尔限速** |
| 实机通信（ROS / SDK） | 不在本仓库 |

### 3.4 基坐标系轴向枚举（易错）

`_AXIS_VEC` / XML help 约定：

| 枚举值 | 含义（单位向量） |
|--------|------------------|
| 1 | +Z |
| 2 | −Z |
| 3 | −X |
| 4 | +X |
| 5 | +Y |
| 6 | +X（与 4 同向，历史备用键） |

当前默认：`BASE_CS_X=6`，`BASE_CS_Z=1` → 基座 X 朝 +X，Z 朝 +Z。  
`cs_to_rotation` 会正交化；若 X∥Z（点积 \|·\| > 0.98）则 **降级为单位阵**，集成时若看到位姿整体错 90°，先查这对枚举。

### 3.5 关节角四种语义（集成必读）

`JointAngleMode`（`fk.joint_q_rad`）：

| 模式 | 含义 | 转换 |
|------|------|------|
| `machine_deg`（默认） | 控制器机器角 | `rad(q)`，可选再乘 `joint_direction` |
| `pendant_deg` | 示教器显示角 | 默认整轴乘 −1 再转 rad |
| `xml_delta_dir` | XML / 模型语义 | `rad((q - offset) * dir)` |
| `raw_deg` | 原始读数 | `rad(q)`，可选方向 |

**与示教对表时**：本仓库测试统一用 `joint_angle_mode="machine_deg"`。  
若现场示教器数字与 FK 差一个符号，优先试 `pendant_deg`，不要先改连杆长度。

---

## 4. 使用什么库与运行环境

### 4.1 声明依赖（`pyproject.toml` / `requirements.txt`）

| 库 | 版本约束 | 用途 |
|----|----------|------|
| **numpy** | `>=1.20,<1.25` | 矩阵、DH、残差向量 |
| **scipy** | `>=1.9,<1.11` | `optimize.least_squares`（IK）；`spatial.transform.Rotation`（示教欧拉角） |
| **pytest**（dev） | `>=7.0,<8.0` | 回归测试 |

标准库：`xml.etree.ElementTree`（解析 `robot.xml`）、`dataclasses` / `typing`。

### 4.2 刻意不引入的库

- 无 PyTorch / ROS / pinocchio / roboticstoolbox：保持轻量、可嵌入。
- 无 ctypes 加载原厂 DLL：`rmp.py` 用纯 Python 对齐历史调用约定。

### 4.3 Python 与安装

- 要求：`Python >= 3.8`
- 建议开发安装：

```bash
cd /root/autodl-tmp
pip install -e ./arm_kin[dev]
# 或
pip install -r arm_kin/requirements.txt
pip install -e ./arm_kin
```

包布局为 **src layout**（`package-dir = {"" = "src"}`），测试里也会把 `src` 插入 `sys.path`，因此「未 install 直接 pytest」也可。

### 4.4 数值与性能注意

- IK 默认 `method="lm"`（无边界，通常更快）；需要软限位时强制走 `trf` + `bounds`。
- 雅可比用有限差分（`jac="2-point"`），无解析 Jacobian；实时控制若嫌慢，需后续换解析解或 C 扩展。
- `get_kinematic_config()` 有进程内单例缓存；**改常量后必须** `clear_kinematic_config_cache()`（测试已 `autouse` 清理）。

---

## 5. 从 0 到可交付的构建顺序

下列顺序与仓库真实依赖一致；新建同类机型项目时按此抄作业即可。

### 步骤 1 — 统一数据模型（`model.py`）

定义：

- `KinematicConfig`：offset / dir / type / `T_base` / `dh_table` / `link_len_m`
- `TeachPendantPose`：示教一行
- `IkResult`：IK 诊断
- `JointAngleMode`、`DhRow`

**验收**：类型可独立 import，无算法依赖。

### 步骤 2 — 写入常量事实（`constants.py`）

写入连杆、零偏、方向、基座枚举、示教点、软限位、关节/笛卡尔速度加速度上限。  
**只放数据，不放计算。**

**验收**：数值与厂家手册或现场 XML 逐项一致。

### 步骤 3 — 示教语义层（`teach.py`）

实现软限位查询/裁剪/判定、示教点导出、`teach_flange_T_m_from_pendant`、安装角 → `R_base`。

**验收**：`position_mm` → `T[:3,3]*1000` 可逆；欧拉序与现场一致。

### 步骤 4 — DH 数学核（`dh.py`）

1. `dh_table_from_link_lengths_m`：L→标准 DH 六行  
2. `standard_dh_link`：单节 4×4  
3. `fk_standard_dh`：全链  
4. `fk_link_poses_accumulated`：中间帧（可视化 / 碰撞预留）

当前偏置腕 DH 结构（θ_offset 恒 0，零偏在关节映射层处理）：

```text
J1: (0, d1, 0,  -π/2)
J2: (0, 0,  a2,  0)
J3: (0, 0,  a3,  0)
J4: (0, d4, 0,  -π/2)
J5: (0, d5, 0,  -π/2)
J6: (0, d6, 0,   0)
```

其中 `(d1,a2,a3,d4,d5,d6) = LINK_LENGTH_MM / 1000`。

**验收**：零位附近末端高度接近 `d1` 量级；与示教点 FK 误差见 §7。

### 步骤 5 — 配置组装与缓存（`config.py`）

`cs_to_rotation` → 安装旋转 → `T_base` → `build_kinematic_config` → `get_kinematic_config` 缓存。

**验收**：改常量后 clear cache 再生效；`T_base` 正交、`det≈+1`。

### 步骤 6 — FK API（`fk.py`）

`joint_q_rad` → `fk_flange` → `fk_tool` / `fk_position_mm`。

**验收**：对全部示教点，位置误差 **&lt; 0.01 mm**（本仓库门限）。

### 步骤 7 — IK 残差与求解（`ik.py`）

- `rotvec_so3`：SO(3)→旋转向量（处理 θ≈0 与 θ≈π）
- `pose_error_se3`：`[Δp(m); w·rotvec]`，默认 `ori_weight=0.3`
- `ik_flange`：`least_squares` + 容差判定

默认容差：

- 位置：`1e-5` m（0.01 mm）
- 姿态：`5e-4` rad（约 0.029°），比较时再乘 `ori_weight`

**验收**：精确初值回环关节角 atol `1e-3` deg；扰动初值下 FK 位姿回环位置 `&lt;1e-4` m。

### 步骤 8 — XML 装载（`robot_xml.py`）

解析 `<Manipulator><Item keyname=… value=…>`，产出 `KinematicConfig` + vel/acc。

**验收**：`link_len_m`、`joint_offset_deg` 与默认常量 atol `1e-9` 一致。

### 步骤 9 — RMP 兼容壳（`rmp.py`）

对齐历史约定：

| 接口 | 输入 | 输出约定 |
|------|------|----------|
| `rmp_forward_kin` | 关节 **rad** | `float32` 长度 16，行主序 4×4 |
| `rmp_forward_kin_all` | rad | `(pose16, [T0…T6, T_tcp])` 共 8 帧 |
| `rmp_inverse_kin` | pose16 + seed rad | `(n_sol, buf[8,6])`，仅填第 0 行 rad |
| `p2p_plan` | start/target rad, dt | `(N,6)`，smooth-step 插值 |
| `rmp_set_tool_transform` | 4×4 | TCP = flange @ tool |

**验收**：RMP FK 与 `fk_flange` 对齐；IK 回环；P2P 起终点精确。

### 步骤 10 — 对外入口（`robot_fk.py` + `__init__.py`）

聚合导出；保留 `get_config` / `set_robot_xml` 别名；`python -m` / 脚本自检打印示教误差。

### 步骤 11 — 自动化测试（`tests/test.py`）

见第 7 节清单；全绿后方可集成。

---

## 6. 关键算法与接口契约（集成侧速查）

### 6.1 FK

```python
from arm_kin import fk_flange, fk_position_mm, fk_tool
import numpy as np

q = np.array([10.0, -20.0, 30.0, 40.0, -50.0, 60.0])  # deg, machine
T_flange = fk_flange(q, joint_angle_mode="machine_deg")  # 4x4, m
p_mm = fk_position_mm(q)                                  # (3,), mm

T_tool = np.eye(4)
T_tool[2, 3] = 0.12   # 法兰下 120 mm
T_tcp = fk_tool(q, T_tool)
```

### 6.2 IK

```python
from arm_kin import ik_flange, IkResult

T = fk_flange(q)
q2 = ik_flange(T, q_seed_deg=q)                 # 失败抛 RuntimeError
detail: IkResult = ik_flange(T, q, return_details=True)
# detail.success / .nfev / .residual_norm / .message
```

集成建议：

1. **初值用当前关节角**，不要用零位（奇异附近易失败）。
2. 失败时换 `lm_method="trf"`、增大 `max_nfev`、或暂时 `enforce_teach_soft_limits=False`。
3. 需要边界时再开软限位；LM 无 bounds。

### 6.3 RMP 风格（对接旧工程）

```python
from arm_kin import RobotRmpKinematics
import numpy as np

r = RobotRmpKinematics("/path/to/robot.xml")  # 或 None 用常量
q = np.deg2rad([10, -20, 30, 40, -50, 60])
pose16 = r.rmp_forward_kin(q)
n, buf = r.rmp_inverse_kin(pose16, q)
traj = r.p2p_plan(q, q + 0.1, dt=0.02)
```

注意：**RMP 关节一律 rad**；高层 FK API 默认 **deg**。混用是集成第一大坑。

### 6.4 单位总表

| 量 | 对外常用单位 | 内部 / 齐次矩阵 |
|----|--------------|-----------------|
| 关节角（fk/ik API） | deg | rad（DH） |
| 关节角（RMP） | rad | rad |
| 连杆长度常量 | mm | m（DH） |
| 法兰位置（示教 / fk_position_mm） | mm | m（T[:3,3]） |
| IK 位置容差 | — | m |
| 姿态误差 | — | rad（旋转向量） |

---

## 7. 如何测试正确性

### 7.1 一键回归

```bash
# 已 editable 安装时
pytest embody_model_eval/arm_kin/tests/test_arm_kin.py -v

# 或从上级目录（README 写法）
pytest arm_kin/tests/test_arm_kin.py -v
```

快速自检（无需 pytest）：

```bash
cd embody_model_eval/arm_kin
PYTHONPATH=src python -m arm_kin.robot_fk
# 或
PYTHONPATH=src python src/arm_kin/robot_fk.py
```

应打印每组示教 FK 误差及 IK 回环 `ok / nfev / residual`。

### 7.2 测试用例与门限（当前 `tests/test.py`）

| 测试 | 验证点 | 通过门限 |
|------|--------|----------|
| `test_fk_position_matches_teach_mm` | FK vs 示教 xyz | ‖Δp‖ &lt; **0.01 mm** |
| `test_ik_roundtrip_exact_seed` | 真值初值 IK | 关节 atol **1e-3 deg** |
| `test_ik_roundtrip_perturbed_seed_lm` | 中等扰动 + LM | 位置 &lt; 1e-4 m；旋转矩阵差 &lt; 1e-3 |
| `test_ik_roundtrip_perturbed_seed_trf` | 大扰动 + TRF | 同上 |
| `test_ik_return_details` | IkResult 字段 | success；nfev&gt;0；残差 &lt; 1e-6 |
| `test_teach_pendant_metadata_matches_module` | 关键常量未漂 | 如 J3 软限 156°、J1 速 120°/s |
| `test_clip_joints_to_teach_soft_limits` | 裁剪逻辑 | 越界轴贴边 |
| `test_teach_flange_T_translation_mm` | mm↔m | atol 1e-9 |
| `test_ik_enforce_teach_soft_limits` | 边界 IK | success 且在软限内 |
| `test_kinematic_config_from_robot_xml_matches_defaults` | XML↔常量 | 几何/零偏一致 |
| `test_rmp_forward_kin_matches_fk_flange` | 两套 FK | rtol/atol 1e-5 |
| `test_rmp_forward_kin_all_eight_frames` | 8 帧链 | pose16 ≡ mats[-1] |
| `test_rmp_inverse_kin_roundtrip` | RMP IK | 关节 rtol 1e-4 / atol 2e-3 rad |
| `test_rmp_p2p_plan_endpoints` | 轨迹端点 | 起精确、终 rtol 1e-5 |
| `test_rmp_set_env_is_noop` | 占位接口 | 返回 0 |

每个用例前会 `clear_kinematic_config_cache()`，避免污染。

### 7.3 换机型 / 改参数后的验收流程（推荐）

1. **静态对齐**：新 `robot.xml` 与 `constants.py` 关键字段一致（写一个小脚本 diff）。  
2. **采 5～9 个示教点** 写入 `TEACH_PENDANT_POSES`。  
3. 只跑 `test_fk_position_matches_teach_mm`：  
   - 误差厘米级 → 先查方向/零偏/基座轴向；  
   - 毫米级系统偏 → 查连杆长度与欧拉序；  
   - &lt;0.01 mm → 几何标定通过。  
4. 跑全量 IK / RMP 测试。  
5. 实机开环：FK 算出的法兰位姿与示教器读数并排对比（不发运动指令）。  
6. 再开小范围点到点，对比 `p2p_plan` 时间是否超过手册限速（当前规划偏保守 smooth-step，非时间最优）。

### 7.4 常见失败与排查

| 现象 | 优先排查 |
|------|----------|
| FK 整体差几十～几百 mm | `LINK_LENGTH_MM`、单位 mm/m 混用 |
| FK 符号/象限错 | `JOINT_DIRECTION`、`pendant_deg` vs `machine_deg` |
| 姿态对、位置错或反之 | 欧拉序；`T_base` 安装角 |
| IK 偶发失败 | 初值；奇异（腕部伸直）；放宽容差或换 `trf` |
| IK 成功但超软限 | `enforce_teach_soft_limits=True` |
| RMP 与 fk 不一致 | 是否设置了 `T_flange_tool`；deg/rad 混用 |
| 改常量不生效 | 未 `clear_kinematic_config_cache()` |

---

## 8. 后续集成建议（对接评测 / 传感器 / 控制）

### 8.1 建议封装边界

对外只暴露薄封装，例如：

```text
ArmKinematicsService
  load(robot_xml | defaults)
  fk(q_deg) -> xyzrpy / 4x4
  ik(T, seed) -> q_deg | error
  set_tcp(T_flange_tool)
  soft_limits() / clip(q)
```

内部继续调用本包，避免业务层直接操作 DH。

### 8.2 与传感器状态页 / 实机联调

- **机械臂卡片读数**：关节用控制器 `machine_deg`；TCP 用 `fk_position_mm` / `fk_flange` 交叉校验。  
- **双击详情**：可展示 `IkResult` 最近一次求解的 `residual_norm`、`nfev`。  
- **「测试连接」**：先读关节 → FK → 与控制器报告法兰比差；超过 1 mm 标红。  
- **Gello / 遥操作**：leader 关节作 seed，follower 目标位姿走 IK；注意 RMP 用 rad。

### 8.3 版本与依赖冲突

本包钉死 `numpy&lt;1.25`、`scipy&lt;1.11`。若宿主环境（如 torch 2.4 栈）需要更新的 numpy，集成前应：

1. 在隔离 venv 跑本包测试确认算法；或  
2. 放宽版本约束并全量复跑 `tests/test.py`（优先）。

### 8.4 已知缺口（排期参考）

1. 解析解 / 多解选择（肘上肘下、腕翻）。  
2. 奇异检测与阻尼最小二乘。  
3. 笛卡尔直线 / 姿态插补（现仅关节 P2P smooth-step）。  
4. 碰撞与 `rmp_set_env` 实体化。  
5. XML 中 ToolCs / 凸包 / STL 的使用。  
6. `JointMin/Max`（XML 硬限）与示教软限统一策略（当前 IK 边界用软限常量，XML 硬限未读入配置）。

---

## 9. 最小可运行示例（复制即用）

```python
import numpy as np
from arm_kin import robot_fk

# 1) FK
q_deg = np.array([10.0, -20.0, 30.0, 40.0, -50.0, 60.0])
T = robot_fk.fk_flange(q_deg, joint_angle_mode="machine_deg")
print("flange xyz mm:", T[:3, 3] * 1000.0)

# 2) IK 回环
q_sol = robot_fk.ik_flange(T, q_deg)
print("ik joints deg:", q_sol)

# 3) 示教对表（应接近 0）
for i, (q, pref) in enumerate(robot_fk.teach_poses_joint_xyz_mm(), 1):
    err = np.linalg.norm(robot_fk.fk_position_mm(q) - pref)
    print(f"teach#{i} err_mm={err:.4f}")

# 4) RMP
r = robot_fk.RobotRmpKinematics(None)
pose16 = r.rmp_forward_kin(np.deg2rad(q_deg))
print("pose16 shape:", pose16.shape)
```

---

## 10. 结语

`arm_kin` 的价值不在「又一个 FK 脚本」，而在于：

1. **物料与单位契约清晰**（示教点 + XML + 常量三源可对拍）；  
2. **数学核与工业壳分层**（DH/IK 可测，RMP 可替换旧 DLL）；  
3. **回归门限可执行**（0.01 mm 级 FK 对表）。

后续集成时：先锁机型物料与示教点 → 全绿测试 → 再挂实机/页面。任何改动连杆、零偏、轴向或欧拉序，都必须重新跑 §7 全量测试。

---

## 附录 A — 当前仓库默认几何快照（EA66）

便于 diff，勿手抄后不更新：

```text
LINK_LENGTH_MM = (182.0, 478.359, 361.183, 174.159, 116.439, 109.807)
JOINT_OFFSET_DEG = (0, -90, 0, -90, 180, 0)
JOINT_DIRECTION = (1, 1, 1, 1, 1, 1)
BASE_CS_X, BASE_CS_Z = 6, 1
TEACH_JOINT_SOFT (J3) = [-156, +156] deg
示教标定点数量 = 9
```

与 `robot.xml` 中 `LinkLength_*` / `JointOffset_*` 一致；速度加速度在 XML 与 `TEACH_JOINT_*` 常量间可能略有差异（XML J3 速 180 vs 常量 150 等）—— **P2P 若从 XML 装载则用 XML 值**，从常量回退则用 `TEACH_*`。集成时以现场手册为准统一一处来源。
