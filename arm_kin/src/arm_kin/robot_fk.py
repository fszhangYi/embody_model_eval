"""
Robot 运动学对外兼容入口。

该文件仅负责 API 聚合与兼容别名，核心实现已原子化拆分到子模块：
- constants.py
- model.py
- teach.py
- dh.py
- config.py
- fk.py
- ik.py
- robot_xml.py
- rmp.py
"""

from __future__ import annotations

import numpy as np

# ============================================================================
# 导入核心运动学组件（供外部直接访问）
# ============================================================================
# 配置管理：全局配置的获取与缓存清理
from .config import clear_kinematic_config_cache, get_kinematic_config

# 常量定义：所有硬编码几何/运动学参数（长度、关节限位、示教样本等）
from .constants import (
    BASE_CS_X,
    BASE_CS_Z,
    JOINT_DIRECTION,
    JOINT_OFFSET_DEG,
    LINK_LENGTH_MM,
    MANIPULATOR_TYPE,
    TEACH_CART_ACCEL_MAX_MM_S2,
    TEACH_CART_VEL_MAX_MM_S,
    TEACH_CART_VEL_MIN_MM_S,
    TEACH_INSTALL_NOTE,
    TEACH_INSTALL_ROT_XB_Q1_DEG,
    TEACH_INSTALL_ROT_Z1_DEG,
    TEACH_JOINT_ACCEL_MAX_DEG_S2,
    TEACH_JOINT_SOFT_MAX_DEG,
    TEACH_JOINT_SOFT_MIN_DEG,
    TEACH_JOINT_VEL_MAX_DEG_S,
    TEACH_JOINT_VEL_MIN_DEG_S,
    TEACH_ORI_ACCEL_MAX_DEG_S2,
    TEACH_ORI_VEL_MAX_DEG_S,
    TEACH_ORI_VEL_MIN_DEG_S,
    TEACH_PENDANT_POSES,
)

# 正向运动学：法兰位姿、TCP位姿、位置提取（毫米）
from .fk import fk_flange, fk_position_mm, fk_tool

# 逆运动学：法兰位姿求解（数值法）
from .ik import ik_flange

# 数据类型定义：DH参数行、IK结果、关节角模式、运动学配置、示教点位
from .model import DhRow, IkResult, JointAngleMode, KinematicConfig, TeachPendantPose

# 兼容层：模拟历史 DLL 接口（提供 RMP 风格的机器人运动学封装）
from .rmp import RobotRmpKinematics

# XML 解析：从 URDF 风格描述文件中加载运动学配置与限位
from .robot_xml import kinematic_config_and_limits_from_robot_xml

# 示教辅助函数：软限位处理、基座标旋转、示教点转换、法兰位姿推算等
from .teach import (
    clip_joints_to_teach_soft_limits,
    joints_within_teach_soft_limits,
    teach_base_rotation_from_install_deg,
    teach_flange_T_m_from_pendant,
    teach_joint_soft_limits_deg,
    teach_poses_joint_xyz_mm,
)


# ============================================================================
# 兼容性别名（用于保持旧代码调用习惯）
# ============================================================================
def get_config() -> KinematicConfig:
    """兼容别名：返回当前全局运动学配置。

    历史接口中常通过 `get_config()` 获取配置对象，
    新实现推荐直接调用 `get_kinematic_config()` 以保持语义明确。
    """
    return get_kinematic_config()


def set_robot_xml(*_args, **_kwargs) -> None:
    """兼容旧名：触发配置缓存重建。

    历史接口原本可传递 XML 路径，以重新加载机器人参数；
    当前模板项目已采用“常量定义 + 显式解析函数”的模式，
    因此该接口保留为无参数的兼容入口，仅清空配置缓存，
    下次调用 `get_kinematic_config()` 时会自动重建。
    """
    clear_kinematic_config_cache()


# ============================================================================
# 模块自检（仅在该文件作为主脚本执行时运行）
# ============================================================================
if __name__ == "__main__":
    # 快速自检 1：使用示教样本验证正向运动学（FK）的位置误差
    # `teach_poses_joint_xyz_mm()` 返回 (关节角度_deg, 参考位置_mm) 列表
    _poses = teach_poses_joint_xyz_mm()
    _errs = []
    for _k, (_q, _ref) in enumerate(_poses, start=1):
        # 计算机器人法兰位置（毫米），输入关节角使用 "machine_deg" 语义
        _p = fk_position_mm(_q, joint_angle_mode="machine_deg")
        # 计算与参考点的欧氏距离误差
        _e = float(np.linalg.norm(_p - _ref))
        _errs.append(_e)
        print(f"pose{_k} FK_mm={np.round(_p, 3)}  ref_mm={np.round(_ref, 3)}  err_mm={_e:.4f}")
    # 输出整体统计：最大误差、平均误差
    print(f"teach poses: max_err_mm={max(_errs):.4f}  mean_err_mm={float(np.mean(_errs)):.4f}")

    # 快速自检 2：FK → IK 回环残差检查
    # 对每个示教点，先通过 FK 得到法兰位姿，再 IK 反求关节角，比较与原关节角的差异
    print("\nIK round-trip (FK -> IK, SciPy least_squares):")
    for _k, (_q, _) in enumerate(_poses, start=1):
        # 正向运动学：关节角（度）→ 法兰位姿（4x4 齐次矩阵）
        _T = fk_flange(_q, joint_angle_mode="machine_deg")
        # 逆运动学：法兰位姿 → 关节角（度），返回 IkResult 对象（包含详细诊断信息）
        _ik = ik_flange(_T, _q, return_details=True)
        _q2 = _ik.joint_deg                           # 逆解得到的关节角（度）
        _terr = float(np.linalg.norm(_q2 - _q))       # 与原始角度的 L2 范数误差
        print(
            f"  pose{_k} ok={_ik.success} nfev={_ik.nfev} "
            f"deg_L2={_terr:.4f} residual={_ik.residual_norm:.2e}",
        )