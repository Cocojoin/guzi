const session = require("./session");
const usersRepository = require("./usersRepository");
const dataAccessService = require("./dataAccessService");

const PRODUCTS_COLLECTION = "products";
const SETTLEMENT_RECORDS_COLLECTION = "settlement_records";
const MATERIAL_EXPENSES_COLLECTION = "material_expenses";
const LOGISTICS_EXPENSES_COLLECTION = "logistics_expenses";
const TECH_SERVICE_EXPENSES_COLLECTION = "tech_service_expenses";
const OPERATION_LOGS_COLLECTION = "admin_operation_logs";

const STORAGE_KEYS = {
  operationLogs: "adminOperationLogsLocal",
  backupConfig: "adminBackupConfig",
  backupMeta: "adminBackupMeta",
  logRetention: "adminLogRetention"
};

const LOG_RETENTION_OPTIONS = [
  { label: "7 天", days: 7 },
  { label: "30 天", days: 30 },
  { label: "90 天", days: 90 },
  { label: "180 天", days: 180 },
  { label: "永久保留", days: 0 }
];

function getFs() {
  return wx.getFileSystemManager();
}

function safeDate(value) {
  if (value instanceof Date) {
    return value;
  }
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(dateLike) {
  const date = safeDate(dateLike);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(dateLike) {
  const date = safeDate(dateLike);
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getMonthKey(dateLike) {
  return formatDate(dateLike).slice(0, 7);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function estimateBytes(text) {
  return unescape(encodeURIComponent(String(text || ""))).length;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
}

function summarizeError(error, fallback = "未知错误") {
  const raw = String((error && (error.errMsg || error.message || error)) || "").trim();
  if (!raw) {
    return fallback;
  }

  if (/permission|auth|denied/i.test(raw)) {
    return "权限不足";
  }
  if (/network|timeout|fail/i.test(raw)) {
    return "网络异常";
  }
  if (/does not exist|collection/i.test(raw)) {
    return "数据集合不存在";
  }

  return raw.slice(0, 48);
}

function suggestErrorAction(error) {
  const raw = String((error && (error.errMsg || error.message || error)) || "").trim();
  if (!raw) {
    return "请稍后重试";
  }

  if (/permission|auth|denied/i.test(raw)) {
    return "请检查云开发集合权限或管理员身份";
  }
  if (/network|timeout|fail/i.test(raw)) {
    return "请检查网络后重试";
  }
  if (/does not exist|collection/i.test(raw)) {
    return "请先初始化对应云数据库集合";
  }
  if (/file|openDocument|writeFile|save/i.test(raw)) {
    return "请检查文件权限或存储空间后重试";
  }

  return "请稍后重试";
}

function formatFailureContext(error, sceneText = "") {
  const reason = summarizeError(error);
  const suggestion = suggestErrorAction(error);
  return `${sceneText ? `${sceneText}；` : ""}失败原因：${reason}；建议：${suggestion}`;
}

function buildOperationLog(input = {}) {
  const currentSession = session.getSession() || {};
  const createdAt = safeDate(input.createdAt || new Date());
  const operatorAccount = String(input.operatorAccount || currentSession.account || "admin");
  const operatorName = String(input.operatorName || "谷圈星社管理员");
  return {
    id: String(input.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    title: String(input.title || "管理操作"),
    target: String(input.target || "-"),
    type: String(input.type || "配置"),
    success: input.success !== false,
    note: String(input.note || ""),
    operator: String(input.operator || `${operatorName} · ${operatorAccount}`),
    operatorAccount,
    createdAt: createdAt.toISOString(),
    time: formatDateTime(createdAt)
  };
}

function getLocalLogs() {
  return wx.getStorageSync(STORAGE_KEYS.operationLogs) || [];
}

function saveLocalLogs(logs) {
  wx.setStorageSync(STORAGE_KEYS.operationLogs, logs);
}

function getLogRetentionConfig() {
  const saved = wx.getStorageSync(STORAGE_KEYS.logRetention) || {};
  const days = Number(saved.days);
  return LOG_RETENTION_OPTIONS.find((item) => item.days === days) || LOG_RETENTION_OPTIONS[2];
}

function saveLogRetentionConfig(days) {
  const nextConfig = LOG_RETENTION_OPTIONS.find((item) => item.days === Number(days)) || LOG_RETENTION_OPTIONS[2];
  wx.setStorageSync(STORAGE_KEYS.logRetention, nextConfig);
  return nextConfig;
}

function shouldKeepLog(item, retentionDays) {
  if (!retentionDays) {
    return true;
  }
  const createdAt = safeDate(item && item.createdAt);
  return createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000 >= Date.now();
}

function cleanupLocalLogs(retentionDays) {
  const source = getLocalLogs().map((item) => buildOperationLog(item));
  const kept = source.filter((item) => shouldKeepLog(item, retentionDays));
  saveLocalLogs(kept);
  return {
    removedCount: Math.max(0, source.length - kept.length),
    logs: kept
  };
}

async function fetchAll(collectionName, where = null) {
  return dataAccessService.fetchAll(collectionName, { where });
}

async function fetchAllSafe(collectionName, where = null) {
  try {
    return await fetchAll(collectionName, where);
  } catch (error) {
    const message = String((error && (error.errMsg || error.message)) || "");
    if (/does not exist|Collection|collection/i.test(message)) {
      return [];
    }
    throw error;
  }
}

async function addOperationLog(input) {
  const retention = getLogRetentionConfig();
  cleanupLocalLogs(retention.days);
  const log = buildOperationLog(input);
  const localLogs = [log].concat(getLocalLogs()).slice(0, 300);
  saveLocalLogs(localLogs);

  dataAccessService.addDoc(OPERATION_LOGS_COLLECTION, log).catch((error) => {
    console.warn("addOperationLog fallback to local only:", error && (error.errMsg || error.message || error));
  });

  return log;
}

function normalizeCloudLog(item = {}) {
  return buildOperationLog({
    ...item,
    id: item.id || item._id,
    createdAt: item.createdAt,
    operator: item.operator || `${item.operatorName || "谷圈星社管理员"} · ${item.operatorAccount || "admin"}`
  });
}

async function listOperationLogs() {
  const retention = getLogRetentionConfig();
  await cleanupOperationLogs({ retentionDays: retention.days });
  const localLogs = getLocalLogs().map((item) => buildOperationLog(item)).filter((item) => shouldKeepLog(item, retention.days));
  let cloudLogs = [];
  try {
    cloudLogs = await fetchAllSafe(OPERATION_LOGS_COLLECTION);
  } catch (error) {
    console.warn("listOperationLogs cloud fetch skipped:", error && (error.errMsg || error.message || error));
  }
  const cloudNormalized = cloudLogs.map(normalizeCloudLog).filter((item) => shouldKeepLog(item, retention.days));
  const merged = {};

  cloudNormalized.concat(localLogs).forEach((item) => {
    const key = item.id || `${item.title}_${item.time}_${item.target}`;
    if (!merged[key]) {
      merged[key] = item;
    }
  });

  return Object.values(merged).sort((left, right) => safeDate(right.createdAt) - safeDate(left.createdAt));
}

async function cleanupOperationLogs(options = {}) {
  const retention = getLogRetentionConfig();
  const retentionDays = options.retentionDays === undefined ? retention.days : Number(options.retentionDays || 0);
  const localResult = cleanupLocalLogs(retentionDays);
  let removedCloudCount = 0;

  try {
    const cloudLogs = await fetchAllSafe(OPERATION_LOGS_COLLECTION);
    const expiredLogs = cloudLogs.filter((item) => !shouldKeepLog(item, retentionDays));
    if (expiredLogs.length) {
      await Promise.all(
        expiredLogs.map((item) => dataAccessService.removeDocById(OPERATION_LOGS_COLLECTION, item._id))
      );
      removedCloudCount = expiredLogs.length;
    }
  } catch (error) {
    console.warn("cleanupOperationLogs cloud cleanup skipped:", error && (error.errMsg || error.message || error));
  }

  return {
    removedCount: localResult.removedCount + removedCloudCount
  };
}

async function clearAllOperationLogs() {
  saveLocalLogs([]);
  let removedCloudCount = 0;

  try {
    const cloudLogs = await fetchAllSafe(OPERATION_LOGS_COLLECTION);
    if (cloudLogs.length) {
      await Promise.all(
        cloudLogs.map((item) => dataAccessService.removeDocById(OPERATION_LOGS_COLLECTION, item._id))
      );
      removedCloudCount = cloudLogs.length;
    }
  } catch (error) {
    console.warn("clearAllOperationLogs cloud cleanup skipped:", error && (error.errMsg || error.message || error));
  }

  return {
    removedCount: removedCloudCount
  };
}

function getBackupConfig() {
  const saved = wx.getStorageSync(STORAGE_KEYS.backupConfig) || {};
  return {
    autoBackup: saved.autoBackup !== false,
    selectedFrequency: saved.selectedFrequency || "每日 03:00"
  };
}

function saveBackupConfig(config) {
  wx.setStorageSync(STORAGE_KEYS.backupConfig, {
    autoBackup: !!config.autoBackup,
    selectedFrequency: config.selectedFrequency || "每日 03:00"
  });
}

function getBackupMeta() {
  return wx.getStorageSync(STORAGE_KEYS.backupMeta) || null;
}

function saveBackupMeta(meta) {
  wx.setStorageSync(STORAGE_KEYS.backupMeta, meta);
}

function countTotalRecords(snapshot) {
  return [
    snapshot.users,
    snapshot.products,
    snapshot.settlementRecords,
    snapshot.materialExpenses,
    snapshot.logisticsExpenses,
    snapshot.operationLogs
  ].reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

async function createBackupSnapshot() {
  const [users, products, settlementRecords, materialExpenses, logisticsExpenses, operationLogs] = await Promise.all([
    usersRepository.listUsers(),
    fetchAllSafe(PRODUCTS_COLLECTION),
    fetchAllSafe(SETTLEMENT_RECORDS_COLLECTION),
    fetchAllSafe(MATERIAL_EXPENSES_COLLECTION),
    fetchAllSafe(LOGISTICS_EXPENSES_COLLECTION),
    listOperationLogs()
  ]);

  const generatedAt = new Date();
  return {
    generatedAt: generatedAt.toISOString(),
    summary: {
      users: users.length,
      products: products.length,
      settlements: settlementRecords.length,
      materialExpenses: materialExpenses.length,
      logisticsExpenses: logisticsExpenses.length,
      operationLogs: operationLogs.length
    },
    users,
    products,
    settlementRecords,
    materialExpenses,
    logisticsExpenses,
    operationLogs
  };
}

function writeFile(filePath, data) {
  return new Promise((resolve, reject) => {
    getFs().writeFile({
      filePath,
      data,
      encoding: "utf8",
      success: resolve,
      fail: reject
    });
  });
}

function openDocument(filePath, fileType = "") {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType,
      showMenu: true,
      success: resolve,
      fail: reject
    });
  });
}

function buildTimestampName(dateLike) {
  const date = safeDate(dateLike);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function runBackup() {
  const snapshot = await createBackupSnapshot();
  const jsonText = JSON.stringify(snapshot, null, 2);
  const fileName = `谷圈星社数据备份_${buildTimestampName(snapshot.generatedAt)}.json`;
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
  await writeFile(filePath, jsonText);

  const meta = {
    fileName,
    filePath,
    lastBackupAt: formatDateTime(snapshot.generatedAt),
    recordCount: countTotalRecords(snapshot),
    fileSize: formatFileSize(estimateBytes(jsonText))
  };
  saveBackupMeta(meta);
  await addOperationLog({
    title: "执行手动备份",
    target: fileName,
    type: "备份",
    note: `共备份 ${meta.recordCount} 条记录`,
    success: true,
    createdAt: snapshot.generatedAt
  });
  return meta;
}

function createSheetXml(name, rows) {
  const rowXml = rows.map((row) => {
    const cells = row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("");
    return `<Row>${cells}</Row>`;
  }).join("");
  return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rowXml}</Table></Worksheet>`;
}

function computeSettlementRecordMetrics(record) {
  const items = Array.isArray(record && record.settlementItems) ? record.settlementItems : [];
  if (!items.length) {
    return {
      gross: toNumber(record && record.gross),
      actualIncome: toNumber(record && record.actualIncome),
      payable: toNumber(record && record.payable),
      commission: toNumber(record && record.commission)
    };
  }

  return items.reduce((sum, item) => {
    const qty = Math.max(0, toNumber(item && item.soldQty));
    const price = toNumber(item && item.price);
    const gross = toNumber(item && (item.totalPrice != null ? item.totalPrice : price * qty));
    const rateFraction = toNumber(item && (item.rateFraction != null ? item.rateFraction : toNumber(item && item.rate) / 100));
    const commission = gross * rateFraction;
    const payable = toNumber(item && (item.payableAmount != null ? item.payableAmount : Math.max(0, gross - commission)));
    const actualIncome = toNumber(item && (item.saleAmount != null ? item.saleAmount : gross));
    return {
      gross: sum.gross + gross,
      actualIncome: sum.actualIncome + actualIncome,
      payable: sum.payable + payable,
      commission: sum.commission + commission
    };
  }, {
    gross: 0,
    actualIncome: 0,
    payable: 0,
    commission: 0
  });
}

function buildStatsRows(settlementRecords, materialExpenses, logisticsExpenses, techServiceExpenses) {
  const settlementTotals = settlementRecords.reduce((sum, item) => {
    const metrics = computeSettlementRecordMetrics(item);
    return {
      gross: sum.gross + metrics.gross,
      actualIncome: sum.actualIncome + metrics.actualIncome,
      commission: sum.commission + metrics.commission,
      payable: sum.payable + metrics.payable
    };
  }, {
    gross: 0,
    actualIncome: 0,
    commission: 0,
    payable: 0
  });
  const gross = settlementTotals.gross;
  const actualIncome = settlementTotals.actualIncome;
  const commission = settlementTotals.commission;
  const payable = settlementTotals.payable;
  const material = materialExpenses.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const logistics = logisticsExpenses.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const techService = techServiceExpenses.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const spread = actualIncome - gross;
  const totalExpense = material + logistics + techService;
  const net = commission + spread - totalExpense;

  return [
    ["指标", "数值"],
    ["结算记录数", String(settlementRecords.length)],
    ["商品价格总额", gross.toFixed(2)],
    ["实际收入总额", actualIncome.toFixed(2)],
    ["应结算总额", payable.toFixed(2)],
    ["平台抽成", commission.toFixed(2)],
    ["差价收益", spread.toFixed(2)],
    ["材料支出", material.toFixed(2)],
    ["物流支出", logistics.toFixed(2)],
    ["技术服务支出", techService.toFixed(2)],
    ["总支出", totalExpense.toFixed(2)],
    ["净收入", net.toFixed(2)]
  ];
}

function buildStatsDetailRows(settlementRecords) {
  const rows = [];

  settlementRecords.forEach((record) => {
    const list = Array.isArray(record && record.settlementItems) ? record.settlementItems : [];
    list.forEach((item) => {
      const qty = Math.max(0, toNumber(item && (item.soldQty != null ? item.soldQty : 1)));
      const price = toNumber(item && item.price);
      const gross = toNumber(item && (item.totalPrice != null ? item.totalPrice : price * qty));
      const rate = toNumber(item && item.rate);
      const commission = gross * (rate / 100);
      const payable = item && item.payableAmount != null
        ? toNumber(item.payableAmount)
        : Math.max(0, gross - commission);
      const actualIncome = item && item.actualIncome != null
        ? toNumber(item.actualIncome)
        : (item && item.saleAmount != null ? toNumber(item.saleAmount) : gross);
      rows.push([
        item.id || item.productId || "",
        item.role || item.series || item.ip || item.title || "已结算商品",
        record.userNickname || record.userName || record.owner || "",
        gross.toFixed(2),
        actualIncome.toFixed(2),
        `${rate.toFixed(0)}%`,
        commission.toFixed(2),
        "已结算",
        item.remark || record.note || "",
        `${record.date || formatDate(record.createdAt || "")} ${record.time || ""}`.trim()
      ]);
    });
  });

  return [
    ["商品编号", "商品名称", "寄售用户", "商品价格", "商品实际收入", "平台抽成比例", "平台抽成金额", "商品状态", "备注", "结算时间"],
    ...rows.sort((left, right) => String(right[9] || "").localeCompare(String(left[9] || "")))
  ];
}

function buildStatsExpenseRows(materialExpenses, logisticsExpenses, techServiceExpenses) {
  const expenseRows = []
    .concat((materialExpenses || []).map((item) => ({
      type: "材料支出",
      name: item.itemName || item.item || "材料支出",
      amount: toNumber(item.amount),
      note: item.note || item.remark || "",
      date: item.date || item.createdAt || "",
      operator: item.operator || item.operatorName || ""
    })))
    .concat((logisticsExpenses || []).map((item) => ({
      type: "物流支出",
      name: "物流支出",
      amount: toNumber(item.amount),
      note: item.note || item.remark || "",
      date: item.date || item.createdAt || "",
      operator: item.operator || item.operatorName || ""
    })))
    .concat((techServiceExpenses || []).map((item) => ({
      type: "技术服务支出",
      name: item.itemName || item.item || "技术服务支出",
      amount: toNumber(item.amount),
      note: item.note || item.remark || "",
      date: item.date || item.createdAt || "",
      operator: item.operator || item.operatorName || ""
    })))
    .sort((left, right) => safeDate(right.date) - safeDate(left.date));

  return [
    ["日期", "支出类型", "支出项目", "金额", "备注", "记录人"],
    ...expenseRows.map((item) => [
      formatDateTime(item.date),
      item.type,
      item.name,
      item.amount.toFixed(2),
      item.note,
      item.operator
    ])
  ];
}

function getDateValue(item) {
  return item.date || item.createdAt || item.updatedAt || "";
}

function isWithinRange(item, range) {
  if (!range || !range.start || !range.end) {
    return true;
  }
  const value = safeDate(getDateValue(item));
  const start = safeDate(`${range.start} 00:00:00`);
  const end = safeDate(`${range.end} 23:59:59`);
  return value >= start && value <= end;
}

function resolveRangeDates(rangeType, customRange) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (rangeType === "本月") {
    return {
      start: `${year}-${pad(month + 1)}-01`,
      end: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`
    };
  }

  if (rangeType === "近三月") {
    const startMonth = new Date(year, month - 2, 1);
    return {
      start: formatDate(startMonth),
      end: formatDate(new Date(year, month + 1, 0))
    };
  }

  if (rangeType === "自定义" && customRange && customRange.start && customRange.end) {
    return {
      start: customRange.start,
      end: customRange.end
    };
  }

  return null;
}

async function createExportFile(options = {}) {
  const range = resolveRangeDates(options.rangeType, options.customRange);
  const selectedKeys = Array.isArray(options.selectedKeys) ? options.selectedKeys : [];
  const [users, products, settlementRecords, materialExpenses, logisticsExpenses, techServiceExpenses, operationLogs] = await Promise.all([
    usersRepository.listUsers({
      includePassword: selectedKeys.includes("users")
    }),
    fetchAllSafe(PRODUCTS_COLLECTION),
    fetchAllSafe(SETTLEMENT_RECORDS_COLLECTION),
    fetchAllSafe(MATERIAL_EXPENSES_COLLECTION),
    fetchAllSafe(LOGISTICS_EXPENSES_COLLECTION),
    fetchAllSafe(TECH_SERVICE_EXPENSES_COLLECTION),
    listOperationLogs()
  ]);

  const filteredUsers = users.filter((item) => isWithinRange(item, range));
  const filteredProducts = products.filter((item) => isWithinRange(item, range));
  const filteredSettlements = settlementRecords.filter((item) => isWithinRange(item, range));
  const filteredMaterial = materialExpenses.filter((item) => isWithinRange(item, range));
  const filteredLogistics = logisticsExpenses.filter((item) => isWithinRange(item, range));
  const filteredTechService = techServiceExpenses.filter((item) => isWithinRange(item, range));
  const filteredLogs = operationLogs.filter((item) => isWithinRange(item, range));

  const sheets = [];

  if (selectedKeys.includes("users")) {
    sheets.push(createSheetXml("用户数据", [
      ["账号", "密码", "昵称", "角色", "状态", "是否寄售", "联系方式", "创建时间"],
      ...filteredUsers.map((item) => [
        item.account || "",
        item.password || "",
        item.nickname || "",
        item.role || "",
        item.status || "",
        item.isAgentEnabled ? "是" : "否",
        item.contactWechat || item.contactMobile || "",
        formatDateTime(item.createdAt)
      ])
    ]));
  }

  if (selectedKeys.includes("goods")) {
    sheets.push(createSheetXml("商品数据", [
      ["编号", "寄售人", "IP", "角色", "系列", "类型", "价格", "状态", "总数", "已售", "已结算", "创建时间"],
      ...filteredProducts.map((item) => [
        item.id || "",
        item.owner || "",
        item.ip || "",
        item.role || "",
        item.series || "",
        item.customType || item.type || "",
        String(item.price || ""),
        item.status || "",
        String(item.totalQuantity || 0),
        String(item.soldCount || 0),
        String(item.settledCount || 0),
        formatDateTime(item.createdAt)
      ])
    ]));
  }

  if (selectedKeys.includes("stats")) {
    sheets.push(createSheetXml("统计明细数据", buildStatsDetailRows(filteredSettlements)));
    sheets.push(createSheetXml("统计汇总数据", buildStatsRows(filteredSettlements, filteredMaterial, filteredLogistics, filteredTechService)));
    sheets.push(createSheetXml("统计支出数据", buildStatsExpenseRows(filteredMaterial, filteredLogistics, filteredTechService)));
  }

  if (selectedKeys.includes("logs")) {
    sheets.push(createSheetXml("操作日志", [
      ["标题", "类型", "对象", "操作人", "结果", "备注", "时间"],
      ...filteredLogs.map((item) => [
        item.title || "",
        item.type || "",
        item.target || "",
        item.operator || "",
        item.success ? "成功" : "失败",
        item.note || "",
        item.time || formatDateTime(item.createdAt)
      ])
    ]));
  }

  const workbook = [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    ...sheets,
    "</Workbook>"
  ].join("");

  const fileName = `谷圈星社数据导出_${buildTimestampName(new Date())}.xls`;
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
  await writeFile(filePath, workbook);

  await addOperationLog({
    title: "导出数据",
    target: fileName,
    type: "导出",
    note: `导出 ${selectedKeys.length} 类数据${range ? `，范围 ${range.start} 至 ${range.end}` : ""}`,
    success: true
  });

  return {
    fileName,
    filePath,
    count: selectedKeys.length
  };
}

module.exports = {
  LOG_RETENTION_OPTIONS,
  STORAGE_KEYS,
  addOperationLog,
  clearAllOperationLogs,
  cleanupOperationLogs,
  createBackupSnapshot,
  createExportFile,
  fetchAllSafe,
  formatDate,
  formatDateTime,
  formatFileSize,
  getBackupConfig,
  getBackupMeta,
  getLogRetentionConfig,
  getMonthKey,
  listOperationLogs,
  openDocument,
  runBackup,
  saveBackupConfig,
  saveLogRetentionConfig,
  summarizeError,
  suggestErrorAction,
  formatFailureContext
};
