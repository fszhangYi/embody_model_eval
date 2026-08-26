import type { ArmStatusResponse } from './armApi'
import { sensorValue } from './sensorI18n'

export type SensorStatus = 'offline' | 'unknown' | 'ok' | 'warn' | 'error'

export interface SensorMetric {
  label: string
  value: string
}

export interface SensorDetailSection {
  title: string
  rows: { label: string; value: string }[]
}

export interface SensorDevice {
  id: string
  kind:
    | 'arm'
    | 'gripper'
    | 'tactile'
    | 'realsense'
    | 'ft'
    | 'gello'
  name: string
  model: string
  endpoint: string
  status: SensorStatus
  note: string
  metrics: SensorMetric[]
  /** Extra content for the detail modal */
  detail: {
    summary: string
    sections: SensorDetailSection[]
    channels?: string[]
    checklist?: string[]
  }
  /** Live arm kinematics payload from arm_kin (arm only). */
  armLive?: ArmStatusResponse
}

function fmtArr(xs: number[] | undefined, prec = 1): string {
  if (!xs?.length) return '—'
  return '[' + xs.map((x) => x.toFixed(prec)).join(', ') + ']'
}

/** Merge /api/sensors/arm payload into the static arm card. */
export function applyArmStatus(base: SensorDevice, arm: ArmStatusResponse): SensorDevice {
  const pose = arm.pose
  const cfg = arm.config
  const teach = arm.teachCheck
  const ik = arm.ikRoundtrip

  const sections: SensorDetailSection[] = [
    {
      title: '连接',
      rows: [
        { label: '后端', value: cfg?.backend || 'arm_kin' },
        { label: '端点', value: arm.endpoint },
        { label: '实机驱动', value: sensorValue(arm.hardwareLinked ? '已连接' : '未接入（运动学仿真）') },
        { label: 'robot.xml', value: cfg?.robotXmlExists ? cfg.robotXml || '—' : sensorValue('缺失') },
        { label: 'arm_kin 根目录', value: cfg?.armKinRoot || '—' },
      ],
    },
    {
      title: '运动学',
      rows: [
        { label: '关节角 q1…q6 (°)', value: pose?.jointText || '—' },
        { label: 'TCP xyz (mm)', value: pose ? `${pose.tcpText}` : '—' },
        { label: '姿态 RX RY RZ (°)', value: pose?.rpyText || '—' },
        { label: '软限位内', value: pose ? sensorValue(pose.withinSoftLimits ? '是' : '否') : '—' },
      ],
    },
    {
      title: '几何参数',
      rows: [
        { label: '型号', value: cfg?.modelName || arm.model },
        { label: 'ManipulatorType', value: cfg ? String(cfg.manipulatorType) : '—' },
        { label: '连杆长度 (mm)', value: fmtArr(cfg?.linkLengthMm, 3) },
        { label: '零位偏置 (°)', value: fmtArr(cfg?.jointOffsetDeg, 1) },
        { label: '关节方向', value: fmtArr(cfg?.jointDirection, 0) },
        {
          label: '软限位 (°)',
          value:
            cfg?.softMinDeg && cfg?.softMaxDeg
              ? `${fmtArr(cfg.softMinDeg, 0)} … ${fmtArr(cfg.softMaxDeg, 0)}`
              : '—',
        },
      ],
    },
  ]

  if (teach) {
    sections.push({
      title: '示教 FK 自检',
      rows: [
        { label: '样本数', value: String(teach.n) },
        { label: '通过', value: sensorValue(teach.passed ? '是' : '否') },
        { label: '门限', value: `${teach.thresholdMm} mm` },
        { label: 'max_err', value: `${teach.maxErrMm.toFixed(4)} mm` },
        { label: 'mean_err', value: `${teach.meanErrMm.toFixed(4)} mm` },
      ],
    })
  }

  if (ik) {
    sections.push({
      title: 'IK 回环',
      rows: [
        { label: '成功', value: sensorValue(ik.success ? '是' : '否') },
        { label: 'nfev', value: String(ik.nfev) },
        { label: 'residual', value: ik.residualNorm.toExponential(2) },
        { label: '关节 L2 误差', value: `${ik.jointErrDegL2.toFixed(4)} °` },
        { label: '求解器', value: ik.message },
      ],
    })
  }

  sections.push({
    title: '诊断',
    rows: [
      { label: '使能', value: sensorValue('仿真') },
      { label: '错误码', value: '—' },
      { label: '温度 / 负载', value: '—' },
      { label: '状态消息', value: arm.message || '—' },
    ],
  })

  const checklist = [
    'arm_kin 可导入',
    'robot.xml 可读',
    teach ? (teach.passed ? '示教 FK 对表通过' : '示教 FK 对表失败') : '示教 FK 待测',
    ik ? (ik.success ? 'IK 回环通过' : 'IK 回环失败') : 'IK 回环待测',
    '实机驱动（待接入）',
  ]

  return {
    ...base,
    name: arm.name || base.name,
    model: arm.model || base.model,
    endpoint: arm.endpoint || base.endpoint,
    status: arm.status,
    note: arm.message || base.note,
    metrics: arm.metrics?.length ? arm.metrics : base.metrics,
    detail: {
      summary:
        arm.message ||
        '六轴机械臂已内置 arm_kin：状态页跑 FK/IK 自检；双击打开「FK/IK 搭建说明」查看完整构建文档。',
      sections,
      channels: ['arm_kin.fk_flange', 'arm_kin.ik_flange', 'teach_pendant_poses'],
      checklist,
    },
    armLive: arm,
  }
}


/** Static layout scaffold — live polling / hardware IO comes later. */
export const SENSOR_DEVICES: SensorDevice[] = [
  {
    id: 'arm-ec616',
    kind: 'arm',
    name: '机械臂',
    model: 'EA66 / EC616',
    endpoint: 'arm_kin://…',
    status: 'unknown',
    note: 'arm_kin 运动学 · 关节角 / 法兰 TCP / 示教 FK 自检（无实机）',
    metrics: [
      { label: '关节', value: '—' },
      { label: 'TCP', value: '—' },
      { label: '使能', value: sensorValue('仿真') },
    ],
    detail: {
      summary: '六轴机械臂运动学内置 arm_kin；点击「测试连接」跑示教 FK / IK 自检。',
      sections: [
        {
          title: '连接',
          rows: [
            { label: '后端', value: 'arm_kin' },
            { label: '控制器地址', value: '—（未接实机）' },
            { label: '最近心跳', value: '—' },
          ],
        },
        {
          title: '运动学',
          rows: [
            { label: '关节角 q1…q6', value: '—' },
            { label: 'TCP xyzrpy', value: '—' },
            { label: '软限位', value: '—' },
          ],
        },
        {
          title: '诊断',
          rows: [
            { label: '使能', value: sensorValue('仿真') },
            { label: '错误码', value: '—' },
            { label: '温度 / 负载', value: '—' },
          ],
        },
      ],
      channels: ['arm_kin.fk_flange', 'arm_kin.ik_flange', 'teach_pendant_poses'],
      checklist: ['arm_kin 可导入', 'robot.xml 可读', '示教 FK 待测', 'IK 回环待测', '实机驱动（待接入）'],
    },
  },
  {
    id: 'gripper-main',
    kind: 'gripper',
    name: '电动夹爪',
    model: '平行夹爪（占位）',
    endpoint: '—',
    status: 'offline',
    note: '开合位置、力矩 / 电流、夹持状态',
    metrics: [
      { label: '开合', value: '—' },
      { label: '力矩', value: '—' },
      { label: '状态', value: '—' },
    ],
    detail: {
      summary: '末端电动夹爪开合与夹持力反馈（占位）。',
      sections: [
        {
          title: '执行器',
          rows: [
            { label: '开合位置', value: '—' },
            { label: '目标开合', value: '—' },
            { label: '速度', value: '—' },
          ],
        },
        {
          title: '力 / 电流',
          rows: [
            { label: '力矩 / 电流', value: '—' },
            { label: '夹持判定', value: '—' },
            { label: '过流保护', value: '—' },
          ],
        },
      ],
      channels: ['gripper_position', 'gripper_effort', 'gripper_state'],
      checklist: ['供电', '总线/串口', '行程标定', '软限位'],
    },
  },
  {
    id: 'tactile-main',
    kind: 'tactile',
    name: '触觉传感器',
    model: '阵列触觉（占位）',
    endpoint: '—',
    status: 'offline',
    note: '接触力分布、峰值与接触面积',
    metrics: [
      { label: '峰值', value: '—' },
      { label: '接触点', value: '—' },
      { label: '频率', value: '—' },
    ],
    detail: {
      summary: '指尖 / 掌面触觉阵列的接触分布与时序（占位，预留热力图区域）。',
      sections: [
        {
          title: '阵列',
          rows: [
            { label: '分辨率', value: '—' },
            { label: '量程', value: '—' },
            { label: '采样率', value: '—' },
          ],
        },
        {
          title: '接触统计',
          rows: [
            { label: '峰值压力', value: '—' },
            { label: '接触面积', value: '—' },
            { label: '质心', value: '—' },
          ],
        },
      ],
      channels: ['tactile_frame', 'tactile_peak', 'tactile_contact'],
      checklist: ['固件版本', '标定文件', 'USB/总线', '时间同步'],
    },
  },
  {
    id: 'rs-chest',
    kind: 'realsense',
    name: 'RealSense · chest',
    model: 'D4xx（占位）',
    endpoint: '—',
    status: 'offline',
    note: '彩色 / 深度流、序列号、帧率与分辨率',
    metrics: [
      { label: '彩色', value: '—' },
      { label: '深度', value: '—' },
      { label: 'FPS', value: '—' },
    ],
    detail: {
      summary: '胸前 RealSense：彩色 + 深度预览与设备信息（占位，预留画面）。',
      sections: [
        {
          title: '设备',
          rows: [
            { label: '序列号', value: '—' },
            { label: '固件', value: '—' },
            { label: 'USB', value: '—' },
          ],
        },
        {
          title: '流配置',
          rows: [
            { label: '彩色分辨率', value: '—' },
            { label: '深度分辨率', value: '—' },
            { label: '目标 FPS', value: '—' },
          ],
        },
      ],
      channels: ['color/image_raw', 'depth/image_raw', 'camera_info'],
      checklist: ['设备枚举', '独占占用检查', '外参标定', '时间戳对齐'],
    },
  },
  {
    id: 'rs-top',
    kind: 'realsense',
    name: 'RealSense · top',
    model: 'D4xx（占位）',
    endpoint: '—',
    status: 'offline',
    note: '彩色 / 深度流、序列号、帧率与分辨率',
    metrics: [
      { label: '彩色', value: '—' },
      { label: '深度', value: '—' },
      { label: 'FPS', value: '—' },
    ],
    detail: {
      summary: '俯视 RealSense：彩色 + 深度预览与设备信息（占位）。',
      sections: [
        {
          title: '设备',
          rows: [
            { label: '序列号', value: '—' },
            { label: '固件', value: '—' },
            { label: 'USB', value: '—' },
          ],
        },
        {
          title: '流配置',
          rows: [
            { label: '彩色分辨率', value: '—' },
            { label: '深度分辨率', value: '—' },
            { label: '目标 FPS', value: '—' },
          ],
        },
      ],
      channels: ['color/image_raw', 'depth/image_raw', 'camera_info'],
      checklist: ['设备枚举', '独占占用检查', '外参标定', '时间戳对齐'],
    },
  },
  {
    id: 'rs-wrist',
    kind: 'realsense',
    name: 'RealSense · wrist',
    model: 'D4xx（占位）',
    endpoint: '—',
    status: 'offline',
    note: '腕部相机；可按现场再增删实例',
    metrics: [
      { label: '彩色', value: '—' },
      { label: '深度', value: '—' },
      { label: 'FPS', value: '—' },
    ],
    detail: {
      summary: '腕部 RealSense：近场观测与手眼标定相关信息（占位）。',
      sections: [
        {
          title: '设备',
          rows: [
            { label: '序列号', value: '—' },
            { label: '固件', value: '—' },
            { label: 'USB', value: '—' },
          ],
        },
        {
          title: '流配置',
          rows: [
            { label: '彩色分辨率', value: '—' },
            { label: '深度分辨率', value: '—' },
            { label: '目标 FPS', value: '—' },
          ],
        },
      ],
      channels: ['color/image_raw', 'depth/image_raw', 'camera_info'],
      checklist: ['线缆固定', '手眼外参', '曝光/增益', '丢帧监视'],
    },
  },
  {
    id: 'ft-wrist',
    kind: 'ft',
    name: '六维力传感器',
    model: 'F/T（占位）',
    endpoint: '—',
    status: 'offline',
    note: 'Fx Fy Fz · Tx Ty Tz，偏置与超量程告警',
    metrics: [
      { label: '力', value: '—' },
      { label: '力矩', value: '—' },
      { label: '偏置', value: '—' },
    ],
    detail: {
      summary: '腕部六维力/力矩：原始读数、偏置与滤波（占位，预留波形）。',
      sections: [
        {
          title: '力 (N)',
          rows: [
            { label: 'Fx', value: '—' },
            { label: 'Fy', value: '—' },
            { label: 'Fz', value: '—' },
          ],
        },
        {
          title: '力矩 (N·m)',
          rows: [
            { label: 'Tx', value: '—' },
            { label: 'Ty', value: '—' },
            { label: 'Tz', value: '—' },
          ],
        },
        {
          title: '标定 / 保护',
          rows: [
            { label: '零偏', value: '—' },
            { label: '滤波截止', value: '—' },
            { label: '超量程', value: '—' },
          ],
        },
      ],
      channels: ['wrench', 'ft_raw', 'ft_bias'],
      checklist: ['安装力矩', '电缆屏蔽', '空载调零', '量程保护'],
    },
  },
  {
    id: 'gello-leader',
    kind: 'gello',
    name: 'Gello 摇操装置',
    model: 'Gello leader（占位）',
    endpoint: '—',
    status: 'offline',
    note: '主臂关节、握持键、通信链路',
    metrics: [
      { label: '关节', value: '—' },
      { label: '握持', value: '—' },
      { label: '链路', value: '—' },
    ],
    detail: {
      summary: 'Gello 主端遥操作：关节映射、按键与从臂跟随链路（占位）。',
      sections: [
        {
          title: '主臂',
          rows: [
            { label: '关节角', value: '—' },
            { label: '握持 / 扳机', value: '—' },
            { label: '死区 / 缩放', value: '—' },
          ],
        },
        {
          title: '链路',
          rows: [
            { label: '通信', value: '—' },
            { label: '延迟', value: '—' },
            { label: '从臂跟随', value: '—' },
          ],
        },
      ],
      channels: ['gello/joint_states', 'gello/buttons', 'teleop/cmd'],
      checklist: ['标定姿态', '关节限位', '急停联动', '跟随增益'],
    },
  },
]

export const STATUS_LABEL: Record<SensorStatus, string> = {
  offline: '未连接',
  unknown: '未知',
  ok: '正常',
  warn: '告警',
  error: '故障',
}

export const KIND_LABEL: Record<SensorDevice['kind'], string> = {
  arm: '机械臂',
  gripper: '夹爪',
  tactile: '触觉',
  realsense: '相机',
  ft: '六维力',
  gello: 'Gello',
}
