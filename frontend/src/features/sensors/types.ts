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

/**
 * MegaCollect-aligned device kinds.
 * Core path: arm · gello · gripper · realsense · bus · pipeline
 * Extension (not in MegaCollect main loop): ft · tactile
 */
export type SensorKind =
  | 'arm'
  | 'gello'
  | 'gripper'
  | 'realsense'
  | 'bus'
  | 'pipeline'
  | 'ft'
  | 'tactile'

export interface SensorDevice {
  id: string
  kind: SensorKind
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
  /** Soft priority for grid ordering (lower = earlier). */
  order?: number
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
        {
          label: '实机驱动',
          value: sensorValue(arm.hardwareLinked ? '已连接' : '未接入（运动学仿真）'),
        },
        {
          label: 'robot.xml',
          value: cfg?.robotXmlExists ? cfg.robotXml || '—' : sensorValue('缺失'),
        },
        { label: 'arm_kin 根目录', value: cfg?.armKinRoot || '—' },
        { label: 'MegaCollect', value: 'UR / Elite · ZMQ :6001（待接入实机）' },
      ],
    },
    {
      title: '运动学',
      rows: [
        { label: '关节角 q1…q6 (°)', value: pose?.jointText || '—' },
        { label: 'TCP xyz (mm)', value: pose ? `${pose.tcpText}` : '—' },
        { label: '姿态 RX RY RZ (°)', value: pose?.rpyText || '—' },
        {
          label: '软限位内',
          value: pose ? sensorValue(pose.withinSoftLimits ? '是' : '否') : '—',
        },
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
      channels: ['arm_kin.fk_flange', 'arm_kin.ik_flange', 'teach_pendant_poses', 'zmq://127.0.0.1:6001'],
      checklist,
    },
    armLive: arm,
  }
}

/**
 * Device catalog aligned with hik_gello/MegaCollect.py sensor stack.
 * Live IO: arm_kin only for now; others are structured placeholders for probes.
 */
export const SENSOR_DEVICES: SensorDevice[] = [
  {
    id: 'arm-ec616',
    kind: 'arm',
    order: 10,
    name: '机械臂 · Follower',
    model: 'UR / Elite（MegaCollect）· arm_kin 仿真',
    endpoint: 'zmq://127.0.0.1:6001',
    status: 'unknown',
    note: '从臂：MegaCollect Server → ZMQ；本页用 arm_kin 做 FK/IK 自检（无实机驱动）',
    metrics: [
      { label: '关节', value: '—' },
      { label: 'TCP', value: '—' },
      { label: '使能', value: sensorValue('仿真') },
    ],
    detail: {
      summary:
        '六轴机械臂运动学内置 arm_kin；点击「测试连接」跑示教 FK / IK 自检。',
      sections: [
        {
          title: '连接',
          rows: [
            { label: '机型', value: 'ur | elite' },
            { label: '机器人 IP', value: '10.111.34.200' },
            { label: 'ZMQ', value: '127.0.0.1:6001' },
            { label: '进程', value: 'launch_robot_server' },
          ],
        },
        {
          title: '运动学',
          rows: [
            { label: '关节角 q1…q6', value: '—' },
            { label: 'TCP xyzrpy', value: '—' },
            { label: '指令关节', value: 'get_command_state' },
          ],
        },
        {
          title: 'IO',
          rows: [
            { label: 'Y005（采集指示）', value: '—' },
            { label: 'X009（采集输入）', value: '—' },
          ],
        },
      ],
      channels: ['get_joint_state', 'command_joint_state', 'robot_set_io'],
      checklist: ['端口映射/socat', 'Server 进程', 'ZMQ 可达', 'arm_kin 自检', '急停联动'],
    },
  },
  {
    id: 'gello-leader',
    kind: 'gello',
    order: 20,
    name: 'Gello · Leader',
    model: 'Dynamixel · FTDI USB',
    endpoint: '/dev/serial/by-id/usb-FTDI_…',
    status: 'offline',
    note: '主臂遥操作：Dynamixel 57600；与从臂初值偏差过大将拒绝跟随',
    metrics: [
      { label: '关节', value: '—' },
      { label: '串口', value: '—' },
      { label: 'Δq_max', value: '—' },
    ],
    detail: {
      summary:
        'Gello Leader：Dynamixel 串口主臂，经 Client 写 ZMQ 指令跟随从臂。',
      sections: [
        {
          title: '主臂',
          rows: [
            { label: '关节角', value: '—' },
            { label: '波特率', value: '57600' },
            { label: '安全门限', value: '0.8 rad vs follower' },
          ],
        },
        {
          title: '链路',
          rows: [
            { label: '通信', value: 'USB Serial → ZMQ command' },
            { label: 'Client 进程', value: 'client_main / run_env' },
            { label: '从臂跟随', value: '—' },
          ],
        },
      ],
      channels: ['gello/joint_states', 'command_joint_state'],
      checklist: ['串口 by-id 存在', 'chmod / 独占', 'Leader–Follower 对齐', 'Client 进程存活'],
    },
  },
  {
    id: 'gripper-dh',
    kind: 'gripper',
    order: 30,
    name: 'DH 夹爪',
    model: 'DH AG95 · Modbus RTU',
    endpoint: '/dev/serial/by-id/usb-FTDI_FT232R_…',
    status: 'offline',
    note: '末端第 7 维；宽度归一化；力参数为目标力而非外力传感器',
    metrics: [
      { label: '开合', value: '—' },
      { label: '初始化', value: '—' },
      { label: '目标力', value: '—' },
    ],
    detail: {
      summary:
        'DH AG95：Modbus 开合与目标力；作为关节第 7 维。',
      sections: [
        {
          title: '执行器',
          rows: [
            { label: '开合位置', value: '—' },
            { label: '原始位置 0–1000', value: '—' },
            { label: '抓取态', value: '—' },
          ],
        },
        {
          title: '力 / 电流',
          rows: [
            { label: '目标力', value: '—' },
            { label: '目标速度', value: '—' },
            { label: '控制模式', value: 'sync | arm-then-gripper' },
          ],
        },
      ],
      channels: ['gripper_norm', 'gripper_init', 'gripper_force_cmd'],
      checklist: ['串口 AB0MIFS5', '初始化 0xA5', '行程标定', '与臂第 7 维同步'],
    },
  },
  {
    id: 'rs-left',
    kind: 'realsense',
    order: 40,
    name: 'RealSense · Left',
    model: 'D4xx · 1280×720@15',
    endpoint: 'serial://317222074437…',
    status: 'offline',
    note: '彩色 / 深度流、序列号角色、帧率与分辨率',
    metrics: [
      { label: '彩色', value: '—' },
      { label: '深度', value: '—' },
      { label: 'FPS', value: '15' },
    ],
    detail: {
      summary: 'MegaCollect Left 相机：彩色 + 深度（占位预览）。',
      sections: [
        {
          title: '设备',
          rows: [
            { label: '角色', value: 'left' },
            { label: '序列号', value: '317222074437 / 233622072962 / …' },
            { label: 'USB', value: '—' },
          ],
        },
        {
          title: '流配置',
          rows: [
            { label: '彩色分辨率', value: '1280×720' },
            { label: '深度分辨率', value: '1280×720' },
            { label: '目标 FPS', value: '15' },
          ],
        },
      ],
      channels: ['color/image_raw', 'depth/image_raw', 'camera_info'],
      checklist: ['设备枚举', '串号∈标定表', 'USB 带宽', '手眼外参'],
    },
  },
  {
    id: 'rs-right',
    kind: 'realsense',
    order: 41,
    name: 'RealSense · Right',
    model: 'D4xx · 1280×720@15',
    endpoint: 'serial://317222073322…',
    status: 'offline',
    note: '彩色 / 深度流、序列号角色、帧率与分辨率',
    metrics: [
      { label: '彩色', value: '—' },
      { label: '深度', value: '—' },
      { label: 'FPS', value: '15' },
    ],
    detail: {
      summary: 'MegaCollect Right 相机：彩色 + 深度（占位预览）。',
      sections: [
        {
          title: '设备',
          rows: [
            { label: '角色', value: 'right' },
            { label: '序列号', value: '317222073322 / 233622076758 / …' },
            { label: 'USB', value: '—' },
          ],
        },
        {
          title: '流配置',
          rows: [
            { label: '彩色分辨率', value: '1280×720' },
            { label: '深度分辨率', value: '1280×720' },
            { label: '目标 FPS', value: '15' },
          ],
        },
      ],
      channels: ['color/image_raw', 'depth/image_raw', 'camera_info'],
      checklist: ['设备枚举', '串号∈标定表', '主从同步', '丢帧监视'],
    },
  },
  {
    id: 'rs-middle',
    kind: 'realsense',
    order: 42,
    name: 'RealSense · Middle / Wrist',
    model: 'D4xx / D405 · resize→1280×720',
    endpoint: 'serial://（其余串号）',
    status: 'offline',
    note: '其余相机归入 Middle；LMM 可映射 wrist / top',
    metrics: [
      { label: '彩色', value: '—' },
      { label: '深度', value: '—' },
      { label: '角色', value: 'middle' },
    ],
    detail: {
      summary: 'Middle / Wrist 相机角色（占位预览）。',
      sections: [
        {
          title: '设备',
          rows: [
            { label: '角色', value: 'middle | wrist | top' },
            { label: '序列号', value: '—' },
            { label: '模式', value: 'real | virtual(pkl)' },
          ],
        },
        {
          title: '流配置',
          rows: [
            { label: '彩色分辨率', value: 'resize → 1280×720' },
            { label: '深度分辨率', value: '—' },
            { label: '目标 FPS', value: '15' },
          ],
        },
      ],
      channels: ['color/image_raw', 'depth/image_raw', 'show_shared_array'],
      checklist: ['线缆固定', '手眼外参', '曝光/增益', '预览 SHM 更新'],
    },
  },
  {
    id: 'bus-serial',
    kind: 'bus',
    order: 50,
    name: '串口 / 端口映射',
    model: 'socat · ttyUSB · by-id',
    endpoint: '/tmp/ttyUR · /dev/ttyUSB*',
    status: 'offline',
    note: 'MegaCollect「端口映射」：chmod USB + socat 映射机器人串口',
    metrics: [
      { label: 'socat', value: '—' },
      { label: 'ttyUR', value: '—' },
      { label: 'USB', value: '—' },
    ],
    detail: {
      summary:
        '端口映射与 USB 串口枢纽：socat、/tmp/ttyUR、Gello/DH by-id。',
      sections: [
        {
          title: '端口映射',
          rows: [
            { label: 'socat', value: './socat.sh' },
            { label: '伪串口', value: '/tmp/ttyUR' },
            { label: '机器人 TCP', value: ':54321' },
          ],
        },
        {
          title: 'USB 设备',
          rows: [
            { label: 'Gello FTDI', value: 'FTAA088F…' },
            { label: 'DH FT232R', value: 'AB0MIFS5…' },
            { label: 'ttyUSB*', value: '—' },
          ],
        },
      ],
      channels: ['socat', 'serial/by-id'],
      checklist: ['socat 运行中', '/tmp/ttyUR 存在', 'by-id 链完整', '权限 666/udev'],
    },
  },
  {
    id: 'pipeline-collect',
    kind: 'pipeline',
    order: 60,
    name: '采集流水线',
    model: 'save_data · SHM · 远程同步',
    endpoint: 'shm://show_shared_array · collection_flag',
    status: 'offline',
    note: '采集进程 + 共享内存预览 + collection_flag + 远程序号同步',
    metrics: [
      { label: '进程', value: '—' },
      { label: 'flag', value: '—' },
      { label: '预览', value: '—' },
    ],
    detail: {
      summary:
        '采集进程、共享内存预览与远程 PC 序号同步。',
      sections: [
        {
          title: '进程',
          rows: [
            { label: '采集', value: 'collect_data_main' },
            { label: 'collection_flag', value: '0 停 / 1 采 / 2 失败' },
            { label: '落盘', value: '—' },
          ],
        },
        {
          title: '共享内存',
          rows: [
            { label: '图像 SHM', value: '1440×2560×3 uint8' },
            { label: '关节 SHM', value: '12×float32 (q + pose)' },
            { label: '最近更新', value: '—' },
          ],
        },
        {
          title: '远程同步',
          rows: [
            { label: 'PC×2', value: 'TCP :12345' },
            { label: '最近序号', value: '—' },
            { label: 'LMM 模式', value: 'lmm_mode buf' },
          ],
        },
      ],
      channels: ['collection_flag', 'show_shared_array', 'joint_shared_array'],
      checklist: ['采集进程存活', 'SHM 可写', '磁盘可写', '远程 PC 可达'],
    },
  },
  {
    id: 'ft-wrist',
    kind: 'ft',
    order: 90,
    name: '六维力（扩展）',
    model: 'F/T — 未接入 MegaCollect 主路径',
    endpoint: '—',
    status: 'offline',
    note: '主采集无独立 F/T；夹爪 target_force ≠ 外力反馈',
    metrics: [
      { label: '力', value: '—' },
      { label: '力矩', value: '—' },
      { label: '偏置', value: '—' },
    ],
    detail: {
      summary: '扩展位：MegaCollect 主路径无独立 F/T；勿与夹爪目标力混淆。',
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
      ],
      channels: ['wrench'],
      checklist: ['确认是否安装 F/T', '驱动与标定', '与夹爪力指令区分'],
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

export const KIND_LABEL: Record<SensorKind, string> = {
  arm: '机械臂',
  gello: 'Gello',
  gripper: '夹爪',
  realsense: '相机',
  bus: '串口总线',
  pipeline: '采集流水线',
  ft: '六维力',
  tactile: '触觉',
}

export function sortedSensorDevices(list: SensorDevice[] = SENSOR_DEVICES): SensorDevice[] {
  return [...list].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}
