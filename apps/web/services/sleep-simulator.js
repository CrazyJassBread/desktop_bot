export const SLEEP_STATES = Object.freeze({
  PREPARING: "PREPARING",
  RELAXING: "RELAXING",
  MONITORING: "MONITORING",
  ANALYZING: "ANALYZING",
  REPORT_READY: "REPORT_READY"
});

export const SLEEP_SCENARIOS = Object.freeze([
  {
    id: "quiet",
    label: "安静的一晚",
    score: 88,
    baseDb: 28,
    eventCount: 2,
    snoreCount: 0,
    stableMinutes: 398,
    summary: "整体环境较安静，夜间只有两次短暂声音事件，稳定睡眠区间较长。",
    suggestion: "今晚保持相同的睡前节奏，继续把手机放远一点。"
  },
  {
    id: "noise",
    label: "噪声干扰的一晚",
    score: 74,
    baseDb: 38,
    eventCount: 8,
    snoreCount: 1,
    stableMinutes: 312,
    summary: "整体可以入睡，但凌晨出现持续道路声，可能受到环境噪声影响。",
    suggestion: "睡前关闭靠街一侧窗户。"
  },
  {
    id: "snore",
    label: "疑似鼾声较多的一晚",
    score: 69,
    baseDb: 35,
    eventCount: 11,
    snoreCount: 6,
    stableMinutes: 286,
    summary: "夜间出现多段疑似鼾声片段，环境稳定性一般。",
    suggestion: "今晚尝试侧睡，并把枕头高度调整到更舒服的位置。"
  }
]);

export function createSleepSession(overrides = {}) {
  const now = new Date();
  const wake = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    state: SLEEP_STATES.PREPARING,
    micStatus: "connected",
    currentDb: 31,
    environment: "安静",
    wakeTime: wake.toTimeString().slice(0, 5),
    autoPrint: false,
    breathStartedAt: null,
    breathPaused: false,
    monitorStartedAt: null,
    elapsedSeconds: 0,
    scenarioId: "quiet",
    wave: waveFrame(31, 0),
    eventCount: 0,
    snoreCount: 0,
    printStatus: "NOT_PRINTED",
    printJobId: null,
    ...overrides
  };
}

export function scenarioById(id) {
  return SLEEP_SCENARIOS.find((scenario) => scenario.id === id) ?? SLEEP_SCENARIOS[0];
}

export function formatSleepDuration(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${hours}小时${String(mins).padStart(2, "0")}分`;
}

export function environmentFromDb(db) {
  if (db < 34) return "安静";
  if (db < 43) return "一般";
  return "偏吵";
}

export function environmentTip(db) {
  if (db < 34) return "当前环境较安静，适合入睡。";
  if (db < 43) return "当前环境基本稳定，可以先做两分钟放松。";
  return "检测到持续道路声，建议关窗后开始监测。";
}

export function relaxationPhase(startedAt, now = Date.now()) {
  if (!startedAt) return { label: "准备", progress: 0, secondsLeft: 120 };
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const cycle = elapsed % 12;
  const secondsLeft = Math.max(0, 120 - elapsed);
  if (cycle < 4) return { label: "吸气", progress: cycle / 4, secondsLeft };
  if (cycle < 6) return { label: "停留", progress: (cycle - 4) / 2, secondsLeft };
  return { label: "呼气", progress: (cycle - 6) / 6, secondsLeft };
}

export function tickMonitoring(session, now = Date.now()) {
  const scenario = scenarioById(session.scenarioId);
  const started = Date.parse(session.monitorStartedAt || new Date(now).toISOString());
  const elapsedSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const pulse = Math.sin(elapsedSeconds / 3) * 4;
  const spike = elapsedSeconds % 17 === 0 ? 10 : elapsedSeconds % 29 === 0 ? 7 : 0;
  const currentDb = Math.max(24, Math.round(scenario.baseDb + pulse + spike));
  const eventCount = Math.min(scenario.eventCount, Math.floor(elapsedSeconds / 12) + (spike ? 1 : 0));
  const snoreCount = Math.min(scenario.snoreCount, Math.floor(elapsedSeconds / 22));
  return {
    ...session,
    elapsedSeconds,
    currentDb,
    environment: environmentFromDb(currentDb),
    wave: waveFrame(currentDb, elapsedSeconds),
    eventCount,
    snoreCount
  };
}

export function waveFrame(db, seed = 0) {
  return Array.from({ length: 28 }, (_, index) => {
    const base = Math.sin((index + seed) / 2.4) * 16 + Math.cos((index + seed) / 5) * 9;
    return Math.max(8, Math.min(58, Math.round(18 + (db - 24) * 0.75 + Math.abs(base))));
  });
}

export function generateSleepReport(session, scenarioId = session.scenarioId) {
  const scenario = scenarioById(scenarioId);
  const today = new Date().toISOString().slice(0, 10);
  const totalMinutes = scenario.id === "quiet" ? 446 : scenario.id === "noise" ? 401 : 386;
  const averageDb = Math.round((scenario.baseDb + (session.currentDb || scenario.baseDb)) / 2);
  return {
    id: `sleep-${Date.now()}`,
    date: today,
    scenarioId: scenario.id,
    score: scenario.score,
    recovery: scenario.score >= 84 ? "恢复较好" : scenario.score >= 74 ? "基本恢复" : "可能受到影响",
    totalMinutes,
    stableMinutes: scenario.stableMinutes,
    averageDb,
    eventCount: scenario.eventCount,
    snoreCount: scenario.snoreCount,
    mainIssue: scenario.id === "quiet" ? "无明显持续干扰" : scenario.id === "noise" ? "凌晨道路声较明显" : "疑似鼾声片段较多",
    summary: scenario.summary,
    suggestion: scenario.suggestion,
    timeline: scenario.id === "quiet"
      ? ["23:21 入睡环境稳定", "02:17 短暂声响", "05:42 短暂翻动声", "07:03 醒来"]
      : scenario.id === "noise"
        ? ["23:34 环境一般", "01:48 声音事件", "02:17 持续道路声", "04:30 恢复稳定", "07:10 醒来"]
        : ["23:28 开始监测", "01:20 疑似鼾声", "02:06 疑似鼾声", "03:44 声音事件", "06:52 醒来"]
  };
}

export function sleepReportPrintContent(report) {
  if (!report) return "";
  return [
    "我的睡眠简报",
    report.date,
    "",
    `睡眠评分：${report.score}分`,
    `睡眠时长估算：${formatSleepDuration(report.totalMinutes)}`,
    `夜间声音事件：${report.eventCount}次`,
    `疑似鼾声片段：${report.snoreCount}段`,
    "",
    `昨夜主要问题：${report.mainIssue}`,
    "",
    `今晚唯一建议：${report.suggestion}`,
    "",
    "* 单麦克风声学估算，仅供健康参考"
  ].join("\n");
}
