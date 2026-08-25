# arm_kin

EC616 / EA66 六轴机械臂正逆运动学，已作为 **embody_model_eval 内置模块** 维护（原独立 `demo_test` 工程已合并）。

## 目录

```
arm_kin/
├── robot.xml
├── 构建思路.md
├── src/arm_kin/     # Python 包
└── tests/
```

## 依赖

`numpy`, `scipy`（见仓库根 `requirements.txt`）。

## 自检

```bash
cd /root/autodl-tmp/embody_model_eval
PYTHONPATH=arm_kin/src python -m arm_kin.robot_fk
pytest arm_kin/tests/test_arm_kin.py -v
```

## 在 embody_model_eval 中使用

传感器页通过 `scripts/arm_kinematics.py` + `scripts/arm_kin_bridge.py` 加载本模块，API 见 `/api/sensors/arm/*`。
