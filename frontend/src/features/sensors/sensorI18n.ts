import { t, trText } from '../../i18n/runtime'

/** Translate common sensor detail row values (yes/no, connected, etc.). */
const VALUE_KEYS: Record<string, string> = {
  '是': 'sensors.row.yes',
  '否': 'sensors.row.no',
  '已连接': 'sensors.row.hardwareLinked',
  '未接入（运动学仿真）': 'sensors.row.hardwareSim',
  '缺失': 'sensors.row.missing',
  '仿真': 'sensors.metric.simulation',
  '—（未接实机）': 'sensors.row.noHardware',
}

const SECTION_KEYS: Record<string, string> = {
  连接: 'sensors.section.connection',
  运动学: 'sensors.section.kinematics',
  几何参数: 'sensors.section.geometry',
  '示教 FK 自检': 'sensors.section.teachFk',
  'IK 回环': 'sensors.section.ikRoundtrip',
  诊断: 'sensors.section.diagnostics',
  执行器: 'sensors.section.actuator',
  设备: 'sensors.section.device',
  链路: 'sensors.section.link',
  '力 / 电流': 'sensors.section.forceCurrent',
  阵列: 'sensors.section.array',
  '接触统计': 'sensors.section.contactStats',
  '流配置': 'sensors.section.streamConfig',
  '标定 / 保护': 'sensors.section.calibProtect',
  主臂: 'sensors.section.leaderArm',
  IO: 'sensors.section.io',
  端口映射: 'sensors.section.portMap',
  'USB 设备': 'sensors.section.usbDev',
  共享内存: 'sensors.section.shm',
  远程同步: 'sensors.section.remoteSync',
  进程: 'sensors.section.process',
  '力 (N)': 'sensors.section.forceN',
  '力矩 (N·m)': 'sensors.section.torqueNm',
}

const ROW_KEYS: Record<string, string> = {
  后端: 'sensors.row.backend',
  端点: 'sensors.row.endpoint',
  实机驱动: 'sensors.row.hardware',
  'robot.xml': 'sensors.row.robotXml',
  'arm_kin 根目录': 'sensors.row.armKinRoot',
  '关节角 q1…q6 (°)': 'sensors.row.jointsDeg',
  '关节角 q1…q6': 'sensors.row.jointsShort',
  'TCP xyz (mm)': 'sensors.row.tcpMm',
  'TCP xyzrpy': 'sensors.row.tcpXyzrpy',
  '姿态 RX RY RZ (°)': 'sensors.row.rpyDeg',
  软限位内: 'sensors.row.withinSoftLimits',
  软限位: 'sensors.row.softLimitShort',
  '软限位 (°)': 'sensors.row.softLimits',
  型号: 'sensors.row.model',
  ManipulatorType: 'sensors.row.manipulatorType',
  '连杆长度 (mm)': 'sensors.row.linkLength',
  '零位偏置 (°)': 'sensors.row.jointOffset',
  关节方向: 'sensors.row.jointDirection',
  样本数: 'sensors.row.sampleCount',
  通过: 'sensors.row.passed',
  门限: 'sensors.row.threshold',
  成功: 'sensors.row.ikSuccess',
  '关节 L2 误差': 'sensors.row.jointErrL2',
  求解器: 'sensors.row.solver',
  使能: 'sensors.row.enabled',
  错误码: 'sensors.row.errorCode',
  '温度 / 负载': 'sensors.row.tempLoad',
  状态消息: 'sensors.row.statusMsg',
  控制器地址: 'sensors.row.controllerAddr',
  最近心跳: 'sensors.row.lastHeartbeat',
  关节: 'sensors.metric.joints',
  TCP: 'sensors.metric.tcp',
}

const CHECK_KEYS: Record<string, string> = {
  'arm_kin 可导入': 'sensors.check.armKinImport',
  'robot.xml 可读': 'sensors.check.robotXml',
  '示教 FK 对表通过': 'sensors.check.teachPass',
  '示教 FK 对表失败': 'sensors.check.teachFail',
  '示教 FK 待测': 'sensors.check.teachPending',
  'IK 回环通过': 'sensors.check.ikPass',
  'IK 回环失败': 'sensors.check.ikFail',
  'IK 回环待测': 'sensors.check.ikPending',
  '实机驱动（待接入）': 'sensors.check.hardwarePending',
  '端口映射/socat': 'sensors.check.portSocat',
  'Server 进程': 'sensors.check.serverProc',
  'ZMQ 可达': 'sensors.check.zmqReach',
  'arm_kin 自检': 'sensors.check.armKinSelf',
  '急停联动': 'sensors.check.estopLink',
  '串口 by-id 存在': 'sensors.check.serialById',
  'chmod / 独占': 'sensors.check.chmodExclusive',
  'Leader–Follower 对齐': 'sensors.check.leaderAlign',
  'Client 进程存活': 'sensors.check.clientAlive',
  '串口 AB0MIFS5': 'sensors.check.serialDh',
  '初始化 0xA5': 'sensors.check.initA5',
  '行程标定': 'sensors.check.travelCalib',
  '与臂第 7 维同步': 'sensors.check.sync7th',
  '设备枚举': 'sensors.check.deviceEnum',
  '串号∈标定表': 'sensors.check.serialInTable',
  'USB 带宽': 'sensors.check.usbBw',
  '手眼外参': 'sensors.check.handEye',
  '主从同步': 'sensors.check.masterSlaveSync',
  '丢帧监视': 'sensors.check.frameDrop',
  '线缆固定': 'sensors.check.cableFix',
  '曝光/增益': 'sensors.check.exposureGain',
  '预览 SHM 更新': 'sensors.check.previewShm',
  'socat 运行中': 'sensors.check.socatRunning',
  '/tmp/ttyUR 存在': 'sensors.check.ttyUrExists',
  'by-id 链完整': 'sensors.check.byIdChain',
  '权限 666/udev': 'sensors.check.permUdev',
  '采集进程存活': 'sensors.check.collectAlive',
  'SHM 可写': 'sensors.check.shmWritable',
  '磁盘可写': 'sensors.check.diskWritable',
  '远程 PC 可达': 'sensors.check.remotePc',
  '确认是否安装 F/T': 'sensors.check.confirmFt',
  '驱动与标定': 'sensors.check.driverCalib',
  '与夹爪力指令区分': 'sensors.check.vsGripForce',
}

const SUMMARY_KEYS: Record<string, string> = {
  '六轴机械臂运动学内置 arm_kin；点击「测试连接」跑示教 FK / IK 自检。': 'sensors.summary.armDefault',
  '六轴机械臂已内置 arm_kin：状态页跑 FK/IK 自检；双击打开「FK/IK 搭建说明」查看完整构建文档。': 'sensors.summary.armLive',
  'Gello Leader：Dynamixel 串口主臂，经 Client 写 ZMQ 指令跟随从臂。': 'sensors.summary.gello',
  'DH AG95：Modbus 开合与目标力；作为关节第 7 维。': 'sensors.summary.gripper',
  'MegaCollect Left 相机：彩色 + 深度（占位预览）。': 'sensors.summary.rsLeft',
  'MegaCollect Right 相机：彩色 + 深度（占位预览）。': 'sensors.summary.rsRight',
  'Middle / Wrist 相机角色（占位预览）。': 'sensors.summary.rsMiddle',
  '端口映射与 USB 串口枢纽：socat、/tmp/ttyUR、Gello/DH by-id。': 'sensors.summary.bus',
  '采集进程、共享内存预览与远程 PC 序号同步。': 'sensors.summary.pipeline',
  '扩展位：MegaCollect 主路径无独立 F/T；勿与夹爪目标力混淆。': 'sensors.summary.ft',
}

export function sensorValue(text: string): string {
  if (!text || text === '—') return text
  const key = VALUE_KEYS[text]
  return key ? t(key) : trText(text)
}

export function sensorSection(title: string): string {
  const key = SECTION_KEYS[title]
  return key ? t(key) : trText(title)
}

export function sensorRow(label: string): string {
  const key = ROW_KEYS[label]
  return key ? t(key) : trText(label)
}

export function sensorCheck(item: string): string {
  const key = CHECK_KEYS[item]
  return key ? t(key) : trText(item)
}

export function sensorSummary(text: string): string {
  const key = SUMMARY_KEYS[text]
  return key ? t(key) : trText(text)
}
