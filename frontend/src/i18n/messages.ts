import type { Locale } from './types'
import { pageStrings } from './pageStrings'

export type MessageTree = {
  common: {
    settings: string
    done: string
    closeSettings: string
    placeholder: string
    live: string
    escHint: string
    escHintSaved: string
    escHintAppearance: string
  }
  nav: {
    switchPages: string
    adjacentHint: string
    loggedIn: string
    logout: string
    loggingOut: string
  }
  pageGroups: Record<
    'overview' | 'eval' | 'act' | 'pi05' | 'tools' | 'hardware',
    { label: string; short: string }
  >
  pages: Record<
    | 'home'
    | 'eval'
    | 'hub'
    | 'pipeline'
    | 'chat'
    | 'robots'
    | 'actPipeline'
    | 'modelAnalysis'
    | 'datasetConverter'
    | 'pi05Pipeline'
    | 'pi05Analysis'
    | 'pi05Setup'
    | 'sensors',
    { label: string; short: string; desc: string }
  >
  settings: {
    title: string
    kicker: string
    navAria: string
    tabs: Record<
      'appearance' | 'language' | 'auth' | 'users' | 'about',
      { label: string; hint: string }
    >
    appearance: {
      theme: string
      themeDesc: string
      themeSystem: string
      themeDark: string
      themeLight: string
      compact: string
      compactDesc: string
      density: string
      densityDesc: string
      densityComfortable: string
      densityCompact: string
      densityDense: string
    }
    language: {
      ui: string
      uiDesc: string
      docs: string
      docsDesc: string
      followUi: string
      applied: string
    }
    auth: {
      cookie: string
      cookieDesc: string
      rbac: string
      rbacDesc: string
      csrf: string
      csrfDesc: string
      token: string
      tokenDesc: string
      tokenBtn: string
    }
    users: {
      current: string
      currentDesc: string
      invite: string
      inviteDesc: string
      inviteBtn: string
      roles: string
      rolesDesc: string
      rolesBtn: string
      tableAria: string
      colUser: string
      colRole: string
      colStatus: string
      roleAdmin: string
      roleEval: string
      roleGuest: string
      statusOnline: string
      statusOff: string
      statusPlaceholder: string
      newUsername: string
      newPassword: string
      newRole: string
      addBtn: string
      adding: string
      loadFail: string
      forbidden: string
      authOff: string
      saved: string
      deleteBtn: string
      enable: string
      disable: string
      resetPassword: string
      resetPasswordPlaceholder: string
      deleteConfirm: string
      cannotDeleteSelf: string
      youBadge: string
    }
    about: {
      p1: string
      li1: string
      li2: string
      li3: string
    }
  }
  home: {
    blurb: string
    kicker: string
    heroTitleBefore: string
    heroTitleAccent: string
    heroLead: string
    ctaEval: string
    ctaHub: string
    pillarsAria: string
    pillars: { title: string; text: string }[]
    modulesTitle: string
    modulesHint: string
    stackTitle: string
    stackHint: string
    stackFrontend: string
    stackFrontendBody: string
    stackServer: string
    stackServerBody: string
    stackData: string
    stackDataBody: string
    stackRobots: string
    stackRobotsBody: string
    footerTag: string
  }
  login: {
    loading: string
    checkingSession: string
    title: string
    sub: string
    username: string
    password: string
    show: string
    hide: string
    submit: string
    submitting: string
    fail: string
    networkError: string
    aside: string
    asideMuted: string
    footerTag: string
  }
}

export const messages: Record<Locale, MessageTree> = {
  zh: {
    common: {
      settings: '设置',
      done: '完成',
      closeSettings: '关闭设置',
      placeholder: '占位',
      live: '已生效',
      escHint: '更改不会保存 · Esc 关闭',
      escHintSaved: '语言偏好已写入本地 · Esc 关闭',
      escHintAppearance: '外观偏好已写入本地 · Esc 关闭',
    },
    nav: {
      switchPages: '切换页面 · Alt+1–{n} 直达 · Alt+←/→ 上/下页',
      adjacentHint: 'Alt+← / Alt+→ 切换相邻页',
      loggedIn: '已登录',
      logout: '退出登录',
      loggingOut: '退出中…',
    },
    pageGroups: {
      overview: { label: '总览', short: '总览' },
      eval: { label: '评测', short: '评测' },
      act: { label: 'ACT', short: 'ACT' },
      pi05: { label: 'π0.5', short: 'π0.5' },
      tools: { label: '工具', short: '工具' },
      hardware: { label: '硬件', short: '硬件' },
    },
    pages: {
      home: {
        label: '项目总览',
        short: '总览',
        desc: 'Embody 平台介绍与入口导航',
      },
      eval: {
        label: '单轨迹评测',
        short: '评测',
        desc: '三臂对照、TCP / 观测 / 任务回放',
      },
      hub: {
        label: 'Hub · 汇总',
        short: 'Hub',
        desc: '多 episode / 多模型对比',
      },
      pipeline: {
        label: '模型数据流',
        short: '数据流',
        desc: 'ComfyUI 风格：训练 / 推理流向演示',
      },
      chat: {
        label: 'AI Chat · Skills',
        short: 'Chat',
        desc: '选 skill、配 Agent 链接、发送诉求看回执',
      },
      robots: {
        label: '机械臂 3D',
        short: '机型',
        desc: '下拉选择机型，Three.js 浏览 URDF',
      },
      actPipeline: {
        label: 'ACT 数据流水线',
        short: 'ACT',
        desc: 'raw → HDF5 → 训练 → 推理 → embody JSON',
      },
      modelAnalysis: {
        label: 'ACT 模型分析',
        short: '分析',
        desc: '解析 ckpt 目录：stats / 优化器 / 权重 / 配置 / 曲线',
      },
      datasetConverter: {
        label: '数据集格式转换',
        short: '转换',
        desc: '异构具身数据：11 类训练生态 lineage 检测与格式互转',
      },
      pi05Pipeline: {
        label: 'π0.5 数据流水线',
        short: 'π0.5',
        desc: 'raw → LeRobot → norm_stats → 训练 → 样本推理 → embody',
      },
      pi05Analysis: {
        label: 'π0.5 模型分析',
        short: '分析',
        desc: '解析配置 / norm_stats / checkpoint 与路径健康',
      },
      pi05Setup: {
        label: 'π0.5 环境检测',
        short: '环境',
        desc: '选择路径并自动检测物料是否满足要求',
      },
      sensors: {
        label: '传感器状态',
        short: '传感器',
        desc: '机械臂 / 夹爪 / 触觉 / RealSense / 六维力 / Gello',
      },
    },
    settings: {
      title: '设置',
      kicker: 'Preferences',
      navAria: '设置分类',
      tabs: {
        appearance: { label: '外观', hint: '主题与界面密度' },
        language: { label: '语言', hint: '界面与文档语言' },
        auth: { label: '鉴权与安全', hint: '会话与细粒度权限' },
        users: { label: '用户管理', hint: '账号与角色' },
        about: { label: '关于', hint: '版本与说明' },
      },
      appearance: {
        theme: '主题',
        themeDesc: '跟随系统，或强制深色 / 浅色。偏好保存在本机，立即生效。',
        themeSystem: '跟随系统',
        themeDark: '深色',
        themeLight: '浅色',
        compact: '紧凑布局',
        compactDesc: '缩小顶栏与模块卡片间距，适合小屏或密集操作。',
        density: '界面密度',
        densityDesc: '参考 VS Code / Linear 的密度档位，调整字号与间距。',
        densityComfortable: '舒适',
        densityCompact: '紧凑',
        densityDense: '密集',
      },
      language: {
        ui: '界面语言',
        uiDesc: '切换全站界面语言（总览、设置、导航及各功能页）；偏好保存在本机。',
        docs: '文档与提示语言',
        docsDesc: '用于 README / 空状态 / Skills 说明等文案；选「跟随界面」时与界面语言一致。',
        followUi: '跟随界面',
        applied: '当前生效文档语言：{lang}',
      },
      auth: {
        cookie: '会话 Cookie 鉴权',
        cookieDesc: '沿用现有 HttpOnly Cookie 登录流；此处为策略开关占位。',
        rbac: '细粒度鉴权（RBAC）',
        rbacDesc: '按模块授予 eval / hub / pipeline / chat 等读写真权限。',
        csrf: 'CSRF / SameSite 加固',
        csrfDesc: '对写接口强制同源与 SameSite=Lax 策略校验。',
        token: 'API Token',
        tokenDesc: '签发只读 / 读写 Personal Access Token（GitHub 风格）。',
        tokenBtn: '生成 Token（即将推出）',
      },
      users: {
        current: '当前用户',
        currentDesc: '已登录账号与角色。',
        invite: '添加用户',
        inviteDesc: '创建本地账号（写入 config/users.json，勿提交仓库）。',
        inviteBtn: '添加…',
        roles: '角色模板',
        rolesDesc: 'admin · 评测员 eval · 访客 guest。',
        rolesBtn: '管理角色',
        tableAria: '用户列表',
        colUser: '用户',
        colRole: '角色',
        colStatus: '状态',
        roleAdmin: '管理员',
        roleEval: '评测员',
        roleGuest: '访客',
        statusOnline: '在线',
        statusOff: '停用',
        statusPlaceholder: '离线',
        newUsername: '用户名',
        newPassword: '密码',
        newRole: '角色',
        addBtn: '添加用户',
        adding: '添加中…',
        loadFail: '加载用户失败：{msg}',
        forbidden: '需要管理员权限',
        authOff: '鉴权已关闭，用户管理不可用',
        saved: '已保存',
        deleteBtn: '删除',
        enable: '启用',
        disable: '停用',
        resetPassword: '重置密码',
        resetPasswordPlaceholder: '新密码（留空不改）',
        deleteConfirm: '确定删除用户「{name}」？',
        cannotDeleteSelf: '不能删除当前登录账号',
        youBadge: '当前',
      },
      about: {
        p1: '设置面板：语言与外观偏好会写入 localStorage；用户管理需管理员登录。',
        li1: '布局参考：VS Code / Cursor Settings、Linear Preferences、GitHub Settings',
        li2: '可在「外观」切换主题 / 紧凑布局 / 密度，「语言」切换界面与文档语言',
        li3: '当前生产鉴权仍以 Cookie 会话为准',
      },
    },
    home: {
      blurb: '具身智能评测 · 机型 · 流水线 · 传感器一体控制台',
      kicker: '项目总览',
      heroTitleBefore: '把策略回放、多机型资产与训练流水线',
      heroTitleAccent: '收进同一工作台',
      heroLead:
        'Embody Model Eval 面向具身策略与模型的功能评测：本地静态托管 + Python 标准库 API，支持 Cookie 鉴权、离线 Three.js 可视化，以及 ACT / Skills Agent 联调。评测页与其它模块平级，从下方入口进入。',
      ctaEval: '进入单轨迹评测',
      ctaHub: '查看 Hub 汇总',
      pillarsAria: '能力支柱',
      pillars: [
        {
          title: '离线评测',
          text: '在同一坐标系叠画 current · GT · predict，量化 TCP 与关节误差，核对「下一时刻」策略是否合理。',
        },
        {
          title: '多机型与感知',
          text: 'SO-100 / EC616 / Koch 等 URDF 浏览，传感器卡片墙与内置 arm_kin 运动学联调。',
        },
        {
          title: '数据与 Agent',
          text: 'ACT 训练推理流水线、ComfyUI 式数据流演示，以及 Skills + 本地 / 远程 Agent Chat。',
        },
      ],
      modulesTitle: '功能模块',
      modulesHint: '与顶栏「页面」菜单同一套路由，可用 Alt+1…N 直达',
      stackTitle: '技术栈一览',
      stackHint: '浏览器端不依赖外网 CDN；服务端以 stdlib 为主',
      stackFrontend: '前端',
      stackFrontendBody: 'React SPA · Three.js / Chart.js / urdf-loader（vendor 离线）',
      stackServer: '服务',
      stackServerBody: 'scripts/agent_server.py：静态托管 + /api/* + Cookie 会话鉴权',
      stackData: '数据',
      stackDataBody: 'data/ episode JSON · Hub 汇总 · ACT → embody 转换',
      stackRobots: '机型',
      stackRobotsBody: 'config/robots.json + URDF mesh · 内置 arm_kin',
      footerTag: '本地评测控制台',
    },
    login: {
      loading: '正在加载…',
      checkingSession: '正在校验会话…',
      title: '登录到 Embody',
      sub: '项目总览 · 评测可视化 · ACT 流水线 · 传感器',
      username: '用户名',
      password: '密码',
      show: '显示',
      hide: '隐藏',
      submit: '登录',
      submitting: '登录中…',
      fail: '登录失败',
      networkError: '网络错误',
      aside: '默认用户 embody；密码见启动日志或 config/.auth.json。',
      asideMuted: '会话 Cookie · HttpOnly · 7 天有效',
      footerTag: '本地评测控制台',
    },
  },
  en: {
    common: {
      settings: 'Settings',
      done: 'Done',
      closeSettings: 'Close settings',
      placeholder: 'Soon',
      live: 'Live',
      escHint: 'Changes are not saved · Esc to close',
      escHintSaved: 'Language preference saved locally · Esc to close',
      escHintAppearance: 'Appearance preference saved locally · Esc to close',
    },
    nav: {
      switchPages: 'Switch page · Alt+1–{n} jump · Alt+←/→ prev/next',
      adjacentHint: 'Alt+← / Alt+→ to switch adjacent pages',
      loggedIn: 'Signed in',
      logout: 'Sign out',
      loggingOut: 'Signing out…',
    },
    pageGroups: {
      overview: { label: 'Overview', short: 'Home' },
      eval: { label: 'Evaluation', short: 'Eval' },
      act: { label: 'ACT', short: 'ACT' },
      pi05: { label: 'π0.5', short: 'π0.5' },
      tools: { label: 'Tools', short: 'Tools' },
      hardware: { label: 'Hardware', short: 'HW' },
    },
    pages: {
      home: {
        label: 'Overview',
        short: 'Home',
        desc: 'Embody platform intro and module entry',
      },
      eval: {
        label: 'Trajectory eval',
        short: 'Eval',
        desc: 'Triple-arm overlay, TCP / obs / task replay',
      },
      hub: {
        label: 'Hub · Summary',
        short: 'Hub',
        desc: 'Multi-episode / multi-model comparison',
      },
      pipeline: {
        label: 'Model dataflow',
        short: 'Flow',
        desc: 'ComfyUI-style train / infer graph demo',
      },
      chat: {
        label: 'AI Chat · Skills',
        short: 'Chat',
        desc: 'Pick a skill, set Agent URL, send a request',
      },
      robots: {
        label: 'Arm 3D',
        short: 'Robots',
        desc: 'Pick a robot and browse URDF in Three.js',
      },
      actPipeline: {
        label: 'ACT data pipeline',
        short: 'ACT',
        desc: 'raw → HDF5 → train → infer → embody JSON',
      },
      modelAnalysis: {
        label: 'ACT model analysis',
        short: 'Analyze',
        desc: 'Inspect ckpt dir: stats / optimizer / weights / config / curves',
      },
      datasetConverter: {
        label: 'Dataset format converter',
        short: 'Convert',
        desc: 'Heterogeneous embodied data: 11 training-ecology lineages detect & convert',
      },
      pi05Pipeline: {
        label: 'π0.5 data pipeline',
        short: 'π0.5',
        desc: 'raw → LeRobot → norm_stats → train → sample infer → embody',
      },
      pi05Analysis: {
        label: 'π0.5 model analysis',
        short: 'Analyze',
        desc: 'Inspect configs / norm_stats / checkpoints and path health',
      },
      pi05Setup: {
        label: 'π0.5 environment check',
        short: 'Env',
        desc: 'Pick paths and auto-check whether materials meet requirements',
      },
      sensors: {
        label: 'Sensor status',
        short: 'Sensors',
        desc: 'Arm / gripper / tactile / RealSense / F/T / Gello',
      },
    },
    settings: {
      title: 'Settings',
      kicker: 'Preferences',
      navAria: 'Settings categories',
      tabs: {
        appearance: { label: 'Appearance', hint: 'Theme and density' },
        language: { label: 'Language', hint: 'UI and docs language' },
        auth: { label: 'Auth & security', hint: 'Session and fine-grained access' },
        users: { label: 'Users', hint: 'Accounts and roles' },
        about: { label: 'About', hint: 'Version and notes' },
      },
      appearance: {
        theme: 'Theme',
        themeDesc: 'Follow the system, or force dark / light. Saved on this device and applied immediately.',
        themeSystem: 'System',
        themeDark: 'Dark',
        themeLight: 'Light',
        compact: 'Compact layout',
        compactDesc: 'Tighten header and module card spacing for smaller screens.',
        density: 'UI density',
        densityDesc: 'Density steps inspired by VS Code / Linear — scales type and spacing.',
        densityComfortable: 'Comfort',
        densityCompact: 'Compact',
        densityDense: 'Dense',
      },
      language: {
        ui: 'Interface language',
        uiDesc: 'Switches the whole app UI (overview, settings, nav, and all modules). Saved on this device.',
        docs: 'Docs & tips language',
        docsDesc: 'For README / empty states / Skills tips. “Follow UI” tracks the interface language.',
        followUi: 'Follow UI',
        applied: 'Effective docs language: {lang}',
      },
      auth: {
        cookie: 'Session cookie auth',
        cookieDesc: 'Uses the existing HttpOnly cookie login flow; toggle is a placeholder.',
        rbac: 'Fine-grained auth (RBAC)',
        rbacDesc: 'Per-module read/write grants for eval / hub / pipeline / chat.',
        csrf: 'CSRF / SameSite hardening',
        csrfDesc: 'Require same-origin and SameSite=Lax checks on write APIs.',
        token: 'API Token',
        tokenDesc: 'Issue read-only / read-write Personal Access Tokens (GitHub-style).',
        tokenBtn: 'Generate token (coming soon)',
      },
      users: {
        current: 'Current user',
        currentDesc: 'Signed-in account and role.',
        invite: 'Add user',
        inviteDesc: 'Create a local account (saved to config/users.json — do not commit).',
        inviteBtn: 'Add…',
        roles: 'Role templates',
        rolesDesc: 'admin · evaluator (eval) · guest.',
        rolesBtn: 'Manage roles',
        tableAria: 'User list',
        colUser: 'User',
        colRole: 'Role',
        colStatus: 'Status',
        roleAdmin: 'Admin',
        roleEval: 'Evaluator',
        roleGuest: 'Guest',
        statusOnline: 'Online',
        statusOff: 'Disabled',
        statusPlaceholder: 'Offline',
        newUsername: 'Username',
        newPassword: 'Password',
        newRole: 'Role',
        addBtn: 'Add user',
        adding: 'Adding…',
        loadFail: 'Failed to load users: {msg}',
        forbidden: 'Admin access required',
        authOff: 'Auth is disabled — user management unavailable',
        saved: 'Saved',
        deleteBtn: 'Delete',
        enable: 'Enable',
        disable: 'Disable',
        resetPassword: 'Reset password',
        resetPasswordPlaceholder: 'New password (leave blank to keep)',
        deleteConfirm: 'Delete user "{name}"?',
        cannotDeleteSelf: 'Cannot delete your own account',
        youBadge: 'You',
      },
      about: {
        p1: 'Settings: language and appearance preferences are saved locally; user management requires an admin session.',
        li1: 'Layout inspired by VS Code / Cursor Settings, Linear Preferences, GitHub Settings',
        li2: 'Use Appearance for theme / compact / density, and Language for UI & docs locale',
        li3: 'Production auth still uses Cookie sessions',
      },
    },
    home: {
      blurb: 'Embodied eval · robots · pipelines · sensors in one console',
      kicker: 'Overview',
      heroTitleBefore: 'Bring policy replay, multi-robot assets, and training pipelines',
      heroTitleAccent: ' into one workbench',
      heroLead:
        'Embody Model Eval targets functional evaluation of embodied policies and models: local static hosting plus a Python stdlib API, Cookie auth, offline Three.js visualization, and ACT / Skills Agent hooks. Eval sits alongside other modules — enter from the links below.',
      ctaEval: 'Open trajectory eval',
      ctaHub: 'Open Hub summary',
      pillarsAria: 'Capability pillars',
      pillars: [
        {
          title: 'Offline eval',
          text: 'Overlay current · GT · predict in one frame, quantify TCP / joint error, and check next-step policies.',
        },
        {
          title: 'Robots & sensing',
          text: 'Browse SO-100 / EC616 / Koch URDFs, sensor cards, and built-in arm_kin kinematics.',
        },
        {
          title: 'Data & Agent',
          text: 'ACT train/infer pipelines, ComfyUI-style dataflow demos, plus Skills and local / remote Agent chat.',
        },
      ],
      modulesTitle: 'Modules',
      modulesHint: 'Same routes as the top page menu — jump with Alt+1…N',
      stackTitle: 'Tech stack',
      stackHint: 'No external CDN in the browser; server leans on stdlib',
      stackFrontend: 'Frontend',
      stackFrontendBody: 'React SPA · Three.js / Chart.js / urdf-loader (offline vendor)',
      stackServer: 'Server',
      stackServerBody: 'scripts/agent_server.py: static hosting + /api/* + Cookie session auth',
      stackData: 'Data',
      stackDataBody: 'data/ episode JSON · Hub summaries · ACT → embody conversion',
      stackRobots: 'Robots',
      stackRobotsBody: 'config/robots.json + URDF meshes · built-in arm_kin',
      footerTag: 'Local eval console',
    },
    login: {
      loading: 'Loading…',
      checkingSession: 'Checking session…',
      title: 'Sign in to Embody',
      sub: 'Overview · eval · ACT pipeline · sensors',
      username: 'Username',
      password: 'Password',
      show: 'Show',
      hide: 'Hide',
      submit: 'Sign in',
      submitting: 'Signing in…',
      fail: 'Sign-in failed',
      networkError: 'Network error',
      aside: 'Default user embody; see startup log or config/.auth.json for the password.',
      asideMuted: 'Session Cookie · HttpOnly · valid 7 days',
      footerTag: 'Local eval console',
    },
  },
}

export function lookupMessage(locale: Locale, path: string): string | undefined {
  const flat = pageStrings[locale]?.[path]
  if (typeof flat === 'string') return flat
  const parts = path.split('.')
  let cur: unknown = messages[locale]
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function formatMessage(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  )
}
