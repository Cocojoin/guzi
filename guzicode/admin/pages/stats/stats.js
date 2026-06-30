const productsRepository = require("../../../utils/productsRepository");
const { addOperationLog, formatFailureContext } = require("../../../utils/adminSettings");
const { navigateAdminRoot } = require("../../../utils/adminNavigation");
const session = require("../../../utils/session");
const { debounce } = require("../../../utils/debounce");
const dataAccessService = require("../../../utils/dataAccessService");
const { getDisplayStatus } = require("../../../utils/productPresentation");
const usersRepository = require("../../../utils/usersRepository");

const SETTLEMENT_RECORDS_COLLECTION = "settlement_records";
const MATERIAL_EXPENSES_COLLECTION = "material_expenses";
const LOGISTICS_EXPENSES_COLLECTION = "logistics_expenses";
const TECH_SERVICE_EXPENSES_COLLECTION = "tech_service_expenses";

function fmtMoney(value) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}¥${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt2(value) {
  const n = Number(value || 0);
  return n.toFixed(2);
}

function fmtSignedMoney(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}¥${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSignedIncomeView(value) {
  const n = Number(value || 0);
  const cls = n > 0 ? "amount-positive" : n < 0 ? "amount-negative" : "";
  return { text: fmtSignedMoney(n), cls };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getMonthKey(dateStr) {
  if (!dateStr) return "";
  const str = String(dateStr);
  if (str.includes("/")) {
    const parts = str.split("/");
    return `${parts[2]}-${String(parts[0]).padStart(2, "0")}`;
  }
  return str.slice(0, 7);
}

function getPresetFromName(name) {
  const map = {
    "包装盒": "box",
    "防撞材料": "protect",
    "透明袋": "bag",
    "标签纸": "label"
  };
  return map[String(name || "").trim()] || "custom";
}

function topLabels(items = [], maxCount = 2) {
  const counts = new Map();
  items.forEach((item) => {
    const label = String(item || "").trim();
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, maxCount)
    .map((entry) => entry[0]);
}

function classifyLogisticsNote(note) {
  const text = String(note || "").trim();
  if (!text) return "物流";
  if (/(退件|退回|退货)/.test(text)) return "退件";
  if (/(寄件|发货|寄出|快递|运费|邮费)/.test(text)) return "寄件";
  return "物流";
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

  const itemMetrics = items.reduce((sum, item) => {
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

  if (record && record.actualIncome != null && record.actualIncome !== "") {
    itemMetrics.actualIncome = toNumber(record.actualIncome);
  }

  return itemMetrics;
}

function getExpenseTypeByView(view) {
  if (view === "material" || view === "materialForm") return "material";
  if (view === "logistics" || view === "logisticsForm") return "logistics";
  if (view === "techService" || view === "techServiceForm") return "techService";
  return "";
}

function getExpenseConfig(type) {
  if (type === "material") {
    return {
      collection: MATERIAL_EXPENSES_COLLECTION,
      listView: "material",
      formView: "materialForm",
      title: "材料支出",
      itemName: "材料支出"
    };
  }
  if (type === "techService") {
    return {
      collection: TECH_SERVICE_EXPENSES_COLLECTION,
      listView: "techService",
      formView: "techServiceForm",
      title: "技术服务支出",
      itemName: "技术服务支出"
    };
  }
  return {
    collection: LOGISTICS_EXPENSES_COLLECTION,
    listView: "logistics",
    formView: "logisticsForm",
    title: "物流支出",
    itemName: "物流支出"
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64,
    submitting: false,
    view: "home",
    previousView: "home",
    statsLoading: true,
    statsLoaded: false,
    statMode: "month",
    showMonthPanel: false,
    selectedMonth: "",
    panelYear: 2026,
    minYear: 2024,
    maxYear: 2026,
    canPrevYear: true,
    canNextYear: false,
    months: [],
    reportSaving: false,

    totalCount: 0,
    upCount: 0,
    soldCount: 0,
    settledCount: 0,

    heroTitle: "本月实际收益",
    heroAmountRaw: 0,
    heroAmountDisplay: "¥0.00",
    heroAmountClass: "",
    commissionIncome: "¥0.00",
    spreadIncome: "¥0.00",
    totalExpense: "-¥0.00",
    salesGross: "¥0.00",
    actualSale: "¥0.00",
    settleIncome: "¥0.00",
    netIncomeRaw: 0,
    netIncomeDisplay: "¥0.00",
    netIncomeClass: "",
    summaryNetIncomeRaw: 0,
    summaryNetIncomeDisplay: "¥0.00",
    summaryNetIncomeClass: "",
    summaryCommissionDisplay: "¥0.00",
    summarySpreadDisplay: "¥0.00",
    summaryExpenseDisplay: "¥0.00",

    monthStatsRaw: null,
    allStatsRaw: null,

    summaryRows: [],

    monthReportData: null,
    monthReportMonthText: "",
    monthReportGeneratedDate: "",
    monthReportTrendText: "本月新增",
    monthReportTrendPositive: true,
    monthReportGrossDisplay: "¥0.00",
    monthReportConsigners: 0,
    monthReportConsignersNew: 0,
    monthReportUsers: 0,
    monthReportUsersNew: 0,
    monthReportSettledIpCount: 0,
    monthReportSettledCount: 0,
    monthReportPosterMonth: "",
    monthReportPosterImages: [],
    monthReportPosterCurrent: 0,
    monthReportCanvasWidth: 0,
    monthReportCanvasHeight: 0,
    monthReportQrCodeSrc: "/assets/month-report/mini-program-code.png",

    incomeItems: [],
    incomeFilter: "month",
    incomeKeyword: "",
    filteredIncomeItems: [],
    showIncomeDatePanel: false,
    incomeDateStart: "2026-05-01",
    incomeDateEnd: "2026-05-31",

    expenseFormDate: "",
    expenseFormAmount: "",
    expenseFormNote: "",
    expenseMaterialItemName: "",
    expenseMaterialPreset: "",
    expenseFormMode: "create",
    expenseVoucherImages: [],
    editingExpenseId: "",

    materialTotal: "-¥0.00",
    materialTotalAll: "-¥0.00",
    materialCountMonth: 0,
    materialCountAll: 0,
    materialEntryNote: "本月 0 笔 · 暂无记录",
    materialStatMode: "month",
    logisticsTotal: "-¥0.00",
    logisticsTotalAll: "-¥0.00",
    logisticsCountMonth: 0,
    logisticsCountAll: 0,
    logisticsEntryNote: "本月 0 笔 · 暂无记录",
    logisticsStatMode: "month",
    techServiceTotal: "-¥0.00",
    techServiceTotalAll: "-¥0.00",
    techServiceCountMonth: 0,
    techServiceCountAll: 0,
    techServiceEntryNote: "本月 0 笔 · 暂无记录",
    techServiceStatMode: "month",

    materialItems: [],
    logisticsItems: [],
    techServiceItems: [],

    showDeleteDialog: false,
    pendingDeleteType: "",
    pendingDeleteId: "",
    previousView: "home",

    settledDetail: null,
    settlementItems: [],
    settlementItemCount: 0,
    settlementVouchers: [],
    settledDetailPayable: "0.00",
    settledDetailGross: "0.00",
    settledDetailCommission: "0.00",
    settledDetailActualIncome: "0.00",
    settledDetailRateText: "0%",
    settledDetailUserInitial: "寄"
  },

  onLoad() {
    this.submitExpenseForm = debounce(this.submitExpenseForm.bind(this), 800);
    this.confirmDeleteExpense = debounce(this.confirmDeleteExpense.bind(this), 800);
    this.goView = debounce(this.goView.bind(this), 500);
    this.goGoodsByStatus = debounce(this.goGoodsByStatus.bind(this), 500);
  },

  async onShow() {
    const currentSession = session.getSession();
    if (!currentSession || currentSession.role !== "admin") {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }
    const sysInfo = wx.getSystemInfoSync();
    const menuBtn = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = sysInfo.statusBarHeight || 20;
    const capGap = menuBtn ? (menuBtn.top - statusBarHeight) * 2 : 8;
    const navBarHeight = menuBtn ? menuBtn.height + capGap : 44;
    const contentPaddingTop = statusBarHeight + navBarHeight;
    this.setData({ statusBarHeight, navBarHeight, contentPaddingTop });
    await this.loadAllStatsData();
  },

  async fetchAll(collectionName, where = {}) {
    try {
      return await dataAccessService.fetchAll(collectionName, { where });
    } catch (error) {
      const msg = String((error && (error.errMsg || error.message)) || "");
      const errCode = Number(error && error.errCode);
      const normalized = msg.toLowerCase();
      // 集合尚未创建时，按空数据处理；首次 add 会自动创建集合
      if (
        errCode === -502005 ||
        normalized.includes("does not exist") ||
        normalized.includes("not exist") ||
        normalized.includes("not exists") ||
        normalized.includes("resourcenotfound") ||
        normalized.includes("db or table not exist") ||
        normalized.includes("database collection not exists")
      ) {
        return [];
      }
      throw error;
    }
  },

  async loadAllStatsData() {
    this.setData({ statsLoading: true });
    try {
      const withTimeoutFallback = (promise, fallback, timeout = 15000) => Promise.race([
        promise.catch(() => fallback),
        new Promise((resolve) => setTimeout(() => resolve(fallback), timeout))
      ]);

      const [products, settlementRecords, materialRecords, logisticsRecords, techServiceRecords, usersRaw, consignmentUsersRaw] = await Promise.all([
        productsRepository.getAllProducts(),
        this.fetchAll(SETTLEMENT_RECORDS_COLLECTION),
        this.fetchAll(MATERIAL_EXPENSES_COLLECTION),
        this.fetchAll(LOGISTICS_EXPENSES_COLLECTION),
        this.fetchAll(TECH_SERVICE_EXPENSES_COLLECTION),
        withTimeoutFallback(usersRepository.listUsers(), []),
        withTimeoutFallback(usersRepository.listConsignmentUsers(), [])
      ]);

      const now = new Date();
      const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      let selectedMonth = this.data.selectedMonth || nowMonth;
      
      if (selectedMonth > nowMonth) {
        selectedMonth = nowMonth;
      }

      const statsCount = this.computeProductCounts(products || []);
      const salesGrossMonth = this.computeSoldGross(products || [], selectedMonth);
      const salesGrossAll = this.computeSoldGross(products || []);
      const monthStatsRaw = this.computeStatsByMonth(settlementRecords, materialRecords, logisticsRecords, techServiceRecords, selectedMonth);
      const allStatsRaw = this.computeStatsAll(settlementRecords, materialRecords, logisticsRecords, techServiceRecords);
      const summaryRows = this.buildSummaryRows(allStatsRaw);
      const previousMonth = this.getPrevMonth(selectedMonth);
      const previousMonthStatsRaw = this.computeStatsByMonth(settlementRecords, materialRecords, logisticsRecords, techServiceRecords, previousMonth);
      const monthReportData = this.buildMonthReportData({
        selectedMonth,
        settlementRecords,
        products,
        users: usersRaw,
        consignmentUsers: consignmentUsersRaw,
        monthStatsRaw,
        previousMonthStatsRaw
      });

      const settlementRecordMap = (settlementRecords || []).reduce((map, record) => {
        const recordId = String(record && (record._id || record.id) || "").trim();
        if (recordId) {
          map[recordId] = record;
        }
        return map;
      }, {});
      const incomeItems = this.buildIncomeItems(settlementRecords || []);
      const materialItems = this.buildMaterialItems(materialRecords || []);
      const logisticsItems = this.buildLogisticsItems(logisticsRecords || []);
      const techServiceItems = this.buildTechServiceItems(techServiceRecords || []);

      this._settlementRecordMap = settlementRecordMap;
      this._incomeItems = incomeItems;

      this.setData({
        ...statsCount,
        selectedMonth,
        panelYear: Number((selectedMonth || nowMonth).split("-")[0]),
        maxYear: now.getFullYear(),
        monthStatsRaw,
        allStatsRaw,
        summaryRows,
        monthReportData,
        monthReportMonthText: monthReportData.monthText,
        monthReportGeneratedDate: monthReportData.generatedDate,
        monthReportTrendText: monthReportData.trendText,
        monthReportTrendPositive: monthReportData.trendPositive,
        monthReportGrossDisplay: fmtMoney(monthReportData.settledGross),
        monthReportConsigners: monthReportData.consignerCount,
        monthReportConsignersNew: monthReportData.consignerNewCount,
        monthReportUsers: monthReportData.userCount,
        monthReportUsersNew: monthReportData.userNewCount,
        monthReportSettledIpCount: monthReportData.settledIpCount,
        monthReportSettledCount: monthReportData.settledCount,
        monthReportPosterMonth: monthReportData.monthText,
        salesGrossMonth,
        salesGrossAll,
        summaryCommissionDisplay: fmtMoney(allStatsRaw.commissionTotal),
        summarySpreadDisplay: fmtMoney(allStatsRaw.spreadTotal),
        summaryExpenseDisplay: fmtMoney(allStatsRaw.totalExpense),
        incomeItems: [],
        materialItems,
        logisticsItems,
        techServiceItems,
        incomeDateStart: `${selectedMonth}-01`,
        incomeDateEnd: `${selectedMonth}-31`,
        materialCountAll: materialItems.length,
        materialCountMonth: materialItems.filter((item) => getMonthKey(item.date) === selectedMonth).length,
        materialEntryNote: this.buildExpenseEntryNote(materialItems, selectedMonth, {
          scopeLabel: "本月",
          emptyLabel: "暂无记录",
          labelGetter: (item) => item.name || "材料"
        }),
        materialTotalAll: fmtMoney(-allStatsRaw.materialTotal),
        materialTotal: fmtMoney(-monthStatsRaw.materialTotal),
        logisticsTotal: fmtMoney(-monthStatsRaw.logisticsTotal),
        logisticsTotalAll: fmtMoney(-allStatsRaw.logisticsTotal),
        logisticsCountMonth: logisticsItems.filter((item) => getMonthKey(item.date) === selectedMonth).length,
        logisticsCountAll: logisticsItems.length,
        logisticsEntryNote: this.buildExpenseEntryNote(logisticsItems, selectedMonth, {
          scopeLabel: "本月",
          emptyLabel: "暂无记录",
          labelGetter: (item) => classifyLogisticsNote(item.note)
        }),
        techServiceTotal: fmtMoney(-monthStatsRaw.techServiceTotal),
        techServiceTotalAll: fmtMoney(-allStatsRaw.techServiceTotal),
        techServiceCountMonth: techServiceItems.filter((item) => getMonthKey(item.date) === selectedMonth).length,
        techServiceCountAll: techServiceItems.length,
        techServiceEntryNote: this.buildExpenseEntryNote(techServiceItems, selectedMonth, {
          scopeLabel: "本月",
          emptyLabel: "暂无记录",
          labelGetter: () => "技术服务"
        }),
        statsLoading: false,
        statsLoaded: true
      }, () => {
        this.applyModeStats();
        this.syncIncomeSigns();
        this.rebuildMonths();
        this.applyIncomeFilter();
      });
    } catch (error) {
      this.setData({ statsLoading: false });
      console.error("loadAllStatsData error:", error);
      wx.showToast({ title: "统计数据加载失败", icon: "none" });
    }
  },

  computeProductCounts(products) {
    return {
      totalCount: products.length,
      upCount: products.filter((item) => getDisplayStatus(item) === "up").length,
      soldCount: products.filter((item) => getDisplayStatus(item) === "sold").length,
      settledCount: products.filter((item) => getDisplayStatus(item) === "settled").length
    };
  },

  computeStatsByMonth(settlementRecords = [], materialRecords = [], logisticsRecords = [], techServiceRecords = [], monthKey) {
    const settled = settlementRecords.filter((item) => getMonthKey(item.date) === monthKey);
    const material = materialRecords.filter((item) => getMonthKey(item.date) === monthKey);
    const logistics = logisticsRecords.filter((item) => getMonthKey(item.date) === monthKey);
    const techService = techServiceRecords.filter((item) => getMonthKey(item.date) === monthKey);
    return this.computeStatsCore(settled, material, logistics, techService);
  },

  computeStatsAll(settlementRecords = [], materialRecords = [], logisticsRecords = [], techServiceRecords = []) {
    return this.computeStatsCore(settlementRecords, materialRecords, logisticsRecords, techServiceRecords);
  },

  computeStatsCore(settlementRecords = [], materialRecords = [], logisticsRecords = [], techServiceRecords = []) {
    const settlementTotals = settlementRecords.reduce((sum, item) => {
      const metrics = computeSettlementRecordMetrics(item);
      return {
        settledPriceTotal: sum.settledPriceTotal + metrics.gross,
        actualIncomeTotal: sum.actualIncomeTotal + metrics.actualIncome,
        commissionTotal: sum.commissionTotal + metrics.commission,
        payableTotal: sum.payableTotal + metrics.payable
      };
    }, {
      settledPriceTotal: 0,
      actualIncomeTotal: 0,
      commissionTotal: 0,
      payableTotal: 0
    });
    const settledPriceTotal = settlementTotals.settledPriceTotal;
    const actualIncomeTotal = settlementTotals.actualIncomeTotal;
    const commissionTotal = settlementTotals.commissionTotal;
    const payableTotal = settlementTotals.payableTotal;
    const spreadTotal = actualIncomeTotal - settledPriceTotal;

    const materialTotal = materialRecords.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const logisticsTotal = logisticsRecords.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const techServiceTotal = techServiceRecords.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const totalExpense = materialTotal + logisticsTotal + techServiceTotal;
    const netIncome = commissionTotal + spreadTotal - totalExpense;

    return {
      settledPriceTotal,
      actualIncomeTotal,
      commissionTotal,
      payableTotal,
      spreadTotal,
      materialTotal,
      logisticsTotal,
      techServiceTotal,
      totalExpense,
      netIncome
    };
  },

  computeSoldGross(products = [], monthKey = "") {
    return (products || []).reduce((sum, product) => {
      const batches = Array.isArray(product && product.soldBatches) ? product.soldBatches : [];
      const matchedBatches = monthKey
        ? batches.filter((batch) => this.isDateInMonth(batch && batch.soldAt, monthKey))
        : batches;
      return sum + matchedBatches.reduce((batchSum, batch) => {
        const qty = Math.max(0, toNumber(batch && batch.qty));
        const price = toNumber(batch && batch.price != null ? batch.price : product && product.price);
        return batchSum + price * qty;
      }, 0);
    }, 0);
  },

  normalizeDateValue(input) {
    if (!input) return null;
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
    if (typeof input === "object") {
      if (input.$date) return this.normalizeDateValue(input.$date);
      if (typeof input.seconds === "number") return new Date(input.seconds * 1000);
      if (typeof input._seconds === "number") return new Date(input._seconds * 1000);
    }
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  },

  isDateInMonth(input, monthKey) {
    const date = this.normalizeDateValue(input);
    if (!date || !monthKey) return false;
    return formatDate(date).slice(0, 7) === monthKey;
  },

  formatMonthText(monthKey) {
    const [year, month] = String(monthKey || "").split("-");
    return `${year} 年 ${Number(month || 0)} 月`;
  },

  formatPercentTrend(current, previous) {
    if (previous <= 0) {
      return current > 0 ? "本月新增" : "暂无变化";
    }
    const percent = Math.round(((current - previous) / previous) * 100);
    return `较上月 ${percent >= 0 ? "+" : ""}${percent}%`;
  },

  buildMonthSoldSummary(products = [], monthKey = "", settlementRecords = []) {
    let soldGross = 0;
    let soldCount = 0;
    const soldIpSet = new Set();

    const settledQtyMap = new Map();
    (settlementRecords || []).forEach((record) => {
      const items = Array.isArray(record && record.settlementItems) ? record.settlementItems : [];
      items.forEach((item) => {
        const soldTimeText = String(item && item.soldTimeText || "");
        const soldMonth = soldTimeText.slice(0, 7);
        const recordMonth = getMonthKey(record && record.date);
        if (soldMonth !== monthKey && recordMonth !== monthKey) {
          return;
        }

        const qty = Math.max(0, toNumber(item && item.soldQty));
        const totalPrice = toNumber(item && (item.totalPrice != null ? item.totalPrice : toNumber(item && item.price) * qty));
        soldCount += qty;
        soldGross += totalPrice;

        const ipLabel = [item && item.ip, item && item.ipName, item && item.series]
          .map((entry) => String(entry || "").trim())
          .find(Boolean);
        if (ipLabel) {
          soldIpSet.add(ipLabel);
        }

        const productId = String(item && (item.productId || item.id) || "").trim();
        if (productId) {
          settledQtyMap.set(productId, (settledQtyMap.get(productId) || 0) + qty);
        }
      });
    });

    (products || []).forEach((product) => {
      const soldBatches = Array.isArray(product && product.soldBatches) ? product.soldBatches : [];
      const matchedBatches = soldBatches.filter((batch) => this.isDateInMonth(batch && batch.soldAt, monthKey));
      if (!matchedBatches.length) {
        return;
      }

      const productId = String(product && (product.id || product._id) || "").trim();
      let settledQtyForMonth = Math.max(0, toNumber(settledQtyMap.get(productId)));

      matchedBatches.forEach((batch) => {
        const batchQty = Math.max(0, toNumber(batch && batch.qty));
        const unsettledQty = Math.max(0, batchQty - settledQtyForMonth);
        settledQtyForMonth = Math.max(0, settledQtyForMonth - batchQty);
        if (!unsettledQty) {
          return;
        }

        const batchPrice = toNumber(batch && batch.price != null ? batch.price : product && product.price);
        soldCount += unsettledQty;
        soldGross += batchPrice * unsettledQty;
      });

      const ipLabel = [product && product.ip, product && product.ipName, product && product.series]
        .map((entry) => String(entry || "").trim())
        .find(Boolean);
      if (ipLabel) {
        soldIpSet.add(ipLabel);
      }
    });

    return {
      soldGross,
      soldCount,
      soldIpCount: soldIpSet.size
    };
  },

  buildMonthReportData({
    selectedMonth,
    settlementRecords = [],
    products = [],
    users = [],
    consignmentUsers = [],
    monthStatsRaw = null,
    previousMonthStatsRaw = null
  }) {
    const monthSoldSummary = this.buildMonthSoldSummary(products, selectedMonth, settlementRecords);
    const currentSettledGross = toNumber(monthStatsRaw && monthStatsRaw.settledPriceTotal);
    const previousSettledGross = toNumber(previousMonthStatsRaw && previousMonthStatsRaw.settledPriceTotal);

    const consignerCount = Array.isArray(consignmentUsers) ? consignmentUsers.length : 0;
    const consignerNewCount = (consignmentUsers || []).filter((item) => this.isDateInMonth(item.consignmentEnabledAt || item.updatedAt || item.createdAt, selectedMonth)).length;
    const userCount = Array.isArray(users) ? users.length : 0;
    const userNewCount = (users || []).filter((item) => this.isDateInMonth(item.createdAt || item.registeredAt || item.updatedAt, selectedMonth)).length;

    return {
      monthKey: selectedMonth,
      monthText: this.formatMonthText(selectedMonth),
      generatedDate: formatDate(new Date()),
      shopName: "谷圈星社",
      shopHandle: "@guzi_shop",
      shopDesc: "谷圈寄售代售",
      reportLabel: "寄售月报",
      settledGross: currentSettledGross,
      settledCount: monthSoldSummary.soldCount,
      settledIpCount: monthSoldSummary.soldIpCount,
      totalProducts: (products || []).length,
      upCount: (products || []).filter((item) => getDisplayStatus(item) === "up").length,
      consignerCount,
      consignerNewCount,
      userCount,
      userNewCount,
      trendText: this.formatPercentTrend(currentSettledGross, previousSettledGross),
      trendPositive: currentSettledGross >= previousSettledGross,
      previousGross: previousSettledGross
    };
  },

  openMonthReport() {
    this.setData({
      previousView: this.data.view || "home",
      view: "monthReport",
      showMonthPanel: false
    });
  },

  async saveMonthReportImage() {
    const report = this.data.monthReportData;
    if (!report) {
      wx.showToast({ title: "当前月份暂无可生成月报的数据", icon: "none" });
      return;
    }
    if (this.data.reportSaving) return;

    this.setData({ reportSaving: true });
    wx.showLoading({ title: "正在保存图片", mask: true });
    try {
      const filePath = await this.renderMonthReportPoster(report);
      await this.ensureAlbumPermissionBySaveAttempt(filePath);
      wx.showToast({ title: "图片已保存到相册", icon: "success" });
    } catch (error) {
      const msg = String((error && error.message) || "");
      if (msg.includes("未开启相册权限")) {
        wx.showToast({ title: "请开启相册权限后再保存", icon: "none" });
      } else {
        wx.showToast({ title: "保存失败，请稍后重试", icon: "none" });
      }
    } finally {
      wx.hideLoading();
      this.setData({ reportSaving: false });
    }
  },

  setDataAsync(payload) {
    return new Promise((resolve) => this.setData(payload, resolve));
  },

  async resolvePosterImagePath(imageUrl) {
    const src = String(imageUrl || "").trim();
    if (!src) {
      return "";
    }
    this._posterImageCache = this._posterImageCache || {};
    if (this._posterImageCache[src]) {
      return this._posterImageCache[src];
    }

    let resolved = src;
    if (/^cloud:\/\//i.test(src)) {
      const res = await wx.cloud.getTempFileURL({ fileList: [src] });
      const tempFile = (res.fileList || [])[0];
      if (!tempFile || tempFile.status !== 0 || !tempFile.tempFileURL) {
        throw new Error("图片加载失败");
      }
      resolved = tempFile.tempFileURL;
    }

    if (/^https?:\/\//i.test(resolved)) {
      resolved = await new Promise((resolve, reject) => {
        wx.downloadFile({
          url: resolved,
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
              resolve(res.tempFilePath);
              return;
            }
            reject(new Error("图片下载失败"));
          },
          fail: () => reject(new Error("图片下载失败"))
        });
      });
    }

    this._posterImageCache[src] = resolved;
    return resolved;
  },

  fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.setFillStyle(fillStyle);
    ctx.fill();
    ctx.restore();
  },

  strokeRoundedRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.setStrokeStyle(strokeStyle);
    ctx.setLineWidth(lineWidth);
    ctx.stroke();
    ctx.restore();
  },

  drawMonthReportPosterCard(ctx, report, canvasWidth, canvasHeight, qrCodePath = "") {
    const pagePadding = 28;
    const cardX = pagePadding;
    const cardY = 56;
    const cardWidth = canvasWidth - pagePadding * 2;
    const headerTop = cardY + 34;
    const coreCardY = headerTop + 102;
    const statY = coreCardY + 172;
    const userCardY = statY + 124;
    const ctaY = userCardY + 164;
    const ctaBottom = ctaY + 132;
    const footerY = ctaBottom + 32;
    const cardHeight = footerY - cardY + 28;
    const titleGradient = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    titleGradient.addColorStop(0, "#ffd3e8");
    titleGradient.addColorStop(1, "#cfd6ff");
    this.fillRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 28, "rgba(255,255,255,0.72)");
    this.strokeRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 28, "rgba(196,220,244,0.92)", 1);

    let y = headerTop;
    ctx.setTextAlign("left");
    const logoSize = 62;
    const headerStartX = cardX + 22;
    const headerGap = 16;
    this.fillRoundedRect(ctx, headerStartX, y - 6, logoSize, logoSize, 20, titleGradient);
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(32);
    ctx.setTextAlign("center");
    ctx.setTextBaseline("middle");
    ctx.fillText("谷", headerStartX + logoSize / 2, y - 6 + logoSize / 2 + 2);
    ctx.setTextAlign("left");
    ctx.setTextBaseline("alphabetic");
    ctx.setFillStyle("#32445f");
    ctx.setFontSize(28);
    ctx.fillText(report.shopName, headerStartX + logoSize + headerGap, y + 18);

    y += 102;
    this.fillRoundedRect(ctx, cardX + 20, y, cardWidth - 40, 142, 24, "rgba(255,255,255,0.94)");
    this.strokeRoundedRect(ctx, cardX + 20, y, cardWidth - 40, 142, 24, "rgba(240,232,255,0.72)", 1);
    ctx.setFillStyle("#7077a4");
    ctx.setFontSize(18);
    ctx.fillText("本月帮谷友成交", cardX + 42, y + 42);
    const amountGradient = ctx.createLinearGradient(cardX + 42, y + 54, cardX + 240, y + 54);
    amountGradient.addColorStop(0, "#c96bd8");
    amountGradient.addColorStop(1, "#5f8dff");
    ctx.setFillStyle(amountGradient);
    ctx.setFontSize(52);
    ctx.fillText(fmtMoney(report.settledGross), cardX + 38, y + 104);

    y += 172;
    const statWidth = (cardWidth - 40 - 18 * 3) / 4;
    const statLabels = [
      [String(report.settledIpCount), "寄售 IP"],
      [String(report.totalProducts), "平台总商品"],
      [String(report.upCount), "当前在售"],
      [String(report.settledCount), "本月成交"]
    ];
    statLabels.forEach((entry, index) => {
      const x = cardX + 20 + index * (statWidth + 18);
      this.fillRoundedRect(ctx, x, statY, statWidth, 100, 22, "rgba(255,255,255,0.92)");
      this.strokeRoundedRect(ctx, x, statY, statWidth, 100, 22, "rgba(232,238,252,0.96)", 1);
      ctx.setFillStyle("#32445f");
      ctx.setFontSize(24);
      ctx.fillText(entry[0], x + 18, statY + 40);
      ctx.setFillStyle("#8c90b4");
      ctx.setFontSize(13);
      ctx.fillText(entry[1], x + 18, statY + 72);
    });

    y += 124;
    const halfWidth = (cardWidth - 52) / 2;
    this.fillRoundedRect(ctx, cardX + 20, y, halfWidth, 140, 24, "rgba(255,221,235,0.72)");
    this.fillRoundedRect(ctx, cardX + 32 + halfWidth, y, halfWidth, 140, 24, "rgba(216,241,255,0.82)");
    this.strokeRoundedRect(ctx, cardX + 20, y, halfWidth, 140, 24, "rgba(255,232,241,0.96)", 1);
    this.strokeRoundedRect(ctx, cardX + 32 + halfWidth, y, halfWidth, 140, 24, "rgba(223,239,255,0.96)", 1);
    ctx.setFillStyle("#d56995");
    ctx.setFontSize(26);
    ctx.fillText(`${report.consignerCount}`, cardX + 42, y + 48);
    ctx.setFontSize(16);
    ctx.fillText("人", cardX + 92, y + 48);
    ctx.setFontSize(15);
    ctx.fillText("寄售谷友", cardX + 42, y + 84);
    this.fillRoundedRect(ctx, cardX + 42, y + 100, 102, 26, 13, "rgba(255,255,255,0.82)");
    ctx.setFontSize(11);
    ctx.fillText(`本月新增 ${report.consignerNewCount}`, cardX + 54, y + 118);
    ctx.setFillStyle("#4c8fdd");
    ctx.setFontSize(26);
    ctx.fillText(`${report.userCount}`, cardX + 54 + halfWidth, y + 48);
    ctx.setFontSize(16);
    ctx.fillText("人", cardX + 104 + halfWidth, y + 48);
    ctx.setFontSize(15);
    ctx.fillText("小程序用户", cardX + 54 + halfWidth, y + 84);
    this.fillRoundedRect(ctx, cardX + 54 + halfWidth, y + 100, 110, 26, 13, "rgba(255,255,255,0.82)");
    ctx.setFontSize(11);
    ctx.fillText(`本月新增 ${report.userNewCount}`, cardX + 66 + halfWidth, y + 118);

    y += 164;
    ctx.setFillStyle("#32445f");
    ctx.setFontSize(28);
    ctx.fillText("把你的谷子交给我们寄售", cardX + 30, y + 40);
    ctx.setFillStyle("#7f84a9");
    ctx.setFontSize(16);
    ctx.fillText("省心代售 · 透明结算", cardX + 30, y + 92);
    const qrX = cardX + cardWidth - 158;
    const qrY = y + 8;
    const qrSize = 124;
    if (qrCodePath) {
      try {
        ctx.drawImage(qrCodePath, qrX, qrY, qrSize, qrSize);
      } catch (error) {
        this.fillRoundedRect(ctx, qrX, qrY, qrSize, qrSize, 20, "rgba(250,248,255,0.94)");
      }
    } else {
      this.fillRoundedRect(ctx, qrX, qrY, qrSize, qrSize, 20, "rgba(250,248,255,0.94)");
    }

    ctx.setTextAlign("center");
    ctx.setFillStyle("#9a99b8");
    ctx.setFontSize(11);
    ctx.fillText(`数据由「${report.shopName}」于 ${report.generatedDate} 生成 · 仅供参考`, canvasWidth / 2, footerY);
    ctx.setTextAlign("left");

    return {
      cropX: cardX,
      cropY: cardY,
      cropWidth: cardWidth,
      cropHeight: cardHeight
    };
  },

  async renderMonthReportPoster(report) {
    const canvasWidth = 750;
    const canvasHeight = 920;
    await this.setDataAsync({
      monthReportCanvasWidth: canvasWidth,
      monthReportCanvasHeight: canvasHeight
    });
    const ctx = wx.createCanvasContext("monthReportCanvas", this);
    ctx.setFillStyle("#ffffff");
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    let qrCodePath = "";
    try {
      qrCodePath = await this.resolvePosterImagePath(this.data.monthReportQrCodeSrc);
    } catch (error) {}
    const cropRect = this.drawMonthReportPosterCard(ctx, report, canvasWidth, canvasHeight, qrCodePath);

    await new Promise((resolve) => ctx.draw(false, resolve));
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvasId: "monthReportCanvas",
        x: cropRect.cropX,
        y: cropRect.cropY,
        width: cropRect.cropWidth,
        height: cropRect.cropHeight,
        destWidth: cropRect.cropWidth * 2,
        destHeight: cropRect.cropHeight * 2,
        fileType: "png",
        quality: 1,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      }, this);
    });
  },

  saveImageToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject });
    });
  },

  ensureAlbumPermissionBySaveAttempt(filePath) {
    return this.saveImageToAlbum(filePath).catch((error) => {
      const errMsg = String((error && error.errMsg) || (error && error.message) || "");
      if (!/auth deny|auth denied|deny|permission|photosalbum/i.test(errMsg)) {
        throw new Error("保存图片失败");
      }
      return new Promise((resolve, reject) => {
        wx.openSetting({
          success: (res) => {
            if (res.authSetting && res.authSetting["scope.writePhotosAlbum"]) {
              this.saveImageToAlbum(filePath).then(resolve).catch(reject);
              return;
            }
            reject(new Error("未开启相册权限"));
          },
          fail: () => reject(new Error("未开启相册权限"))
        });
      });
    });
  },

  buildSummaryRows(allStats) {
    return [
      { label: "已结算商品价格总额", note: "Σ 商品价格", value: fmtMoney(allStats.settledPriceTotal) },
      { label: "已结算商品实际收入总额", note: "Σ 商品实际收入", value: fmtMoney(allStats.actualIncomeTotal) },
      { label: "平台抽成总收入", note: "Σ 商品价格 × 抽成比例", value: fmtMoney(allStats.commissionTotal), positive: allStats.commissionTotal > 0 },
      { label: "寄售用户结算总支出", note: "Σ 商品价格 ×（1 - 抽成）", value: fmtMoney(-allStats.payableTotal), negative: true },
      {
        label: "平台差价收益",
        note: "实际收入 － 商品价格",
        value: fmtSignedMoney(allStats.spreadTotal),
        positive: allStats.spreadTotal > 0,
        negative: allStats.spreadTotal < 0
      },
      { label: "材料费用总支出", note: "Σ 材料支出", value: fmtMoney(-allStats.materialTotal), negative: true },
      { label: "物流费用总支出", note: "Σ 物流支出", value: fmtMoney(-allStats.logisticsTotal), negative: true },
      { label: "技术服务费用总支出", note: "Σ 技术服务支出", value: fmtMoney(-allStats.techServiceTotal), negative: true }
    ];
  },

  buildIncomeItems(settlementRecords = []) {
    const rows = [];
    settlementRecords.forEach((record) => {
      const list = record.settlementItems || [];
      list.forEach((item) => {
        const qty = toNumber(item.soldQty || 1);
        const price = toNumber(item.price);
        const gross = price * qty;
        const rate = toNumber(item.rate);
        const commission = gross * (rate / 100);
        const payableAmount = item.payableAmount != null
          ? toNumber(item.payableAmount)
          : Math.max(0, gross - commission);

        rows.push({
          id: `${record._id || record.id || record.date}-${item.id || item.productId || Math.random()}`,
          productId: item.id || item.productId || "",
          settlementRecordId: record._id || record.id || "",
          title: item.role || item.series || item.ip || item.id || "已结算商品",
          code: `${item.id || ""} · ${record.userNickname || ""}`.trim(),
          userId: record.userId || "",
          userNickname: record.userNickname || "未知用户",
          userAccount: record.userAccount || "",
          price: fmtMoney(gross),
          income: fmtMoney(payableAmount),
          commission: fmtMoney(commission),
          rateText: `${rate.toFixed(0)}%`,
          statusText: "已结算",
          remark: item.remark || record.note || "",
          time: `${record.date || ""} ${record.time || ""}`.trim(),
          source: record.userNickname || ""
        });
      });
    });

    return rows.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  },

  buildMaterialItems(records = []) {
    return records
      .map((item) => ({
        id: item._id,
        name: item.itemName || item.item || "材料支出",
        date: item.date || "",
        note: item.note || "",
        vouchers: item.vouchers || [],
        amountRaw: toNumber(item.amount),
        amount: fmtMoney(-toNumber(item.amount)),
        meta: `${item.date || ""} · ${item.note || ""}`.trim()
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  buildLogisticsItems(records = []) {
    return records
      .map((item) => ({
        id: item._id,
        name: "物流支出",
        date: item.date || "",
        note: item.note || "",
        amountRaw: toNumber(item.amount),
        amount: fmtMoney(-toNumber(item.amount)),
        meta: `${item.date || ""} · ${item.note || ""}`.trim()
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  buildTechServiceItems(records = []) {
    return records
      .map((item) => ({
        id: item._id,
        name: "技术服务支出",
        date: item.date || "",
        note: item.note || "",
        amountRaw: toNumber(item.amount),
        amount: fmtMoney(-toNumber(item.amount)),
        meta: `${item.date || ""} · ${item.note || ""}`.trim()
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  buildExpenseEntryNote(items = [], monthKey, options = {}) {
    const scopeLabel = options.scopeLabel || "本月";
    const emptyLabel = options.emptyLabel || "暂无记录";
    const monthItems = monthKey ? items.filter((item) => getMonthKey(item.date) === monthKey) : items.slice();
    const count = monthItems.length;
    const labelGetter = typeof options.labelGetter === "function" ? options.labelGetter : (() => "");
    const labels = topLabels(monthItems.map(labelGetter), 2);
    return `${scopeLabel} ${count} 笔 · ${labels.length ? labels.join(" / ") : emptyLabel}`;
  },

  rebuildMonths() {
    const panelYear = Number(this.data.panelYear || new Date().getFullYear());
    const selectedMonth = this.data.selectedMonth || "";
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const months = Array.from({ length: 12 }).map((_, index) => {
      const monthNum = index + 1;
      const value = `${panelYear}-${String(monthNum).padStart(2, "0")}`;
      const disabled = panelYear > currentYear || (panelYear === currentYear && monthNum > currentMonth);
      return {
        label: `${monthNum}月`,
        value,
        hint: monthNum === 3 || monthNum === 4,
        active: selectedMonth === value,
        disabled
      };
    });

    this.setData({
      months,
      canPrevYear: panelYear > this.data.minYear,
      canNextYear: panelYear < this.data.maxYear
    });
  },

  syncIncomeSigns() {
    const hero = getSignedIncomeView(this.data.heroAmountRaw);
    const net = getSignedIncomeView(this.data.netIncomeRaw);
    const summaryNet = getSignedIncomeView(this.data.summaryNetIncomeRaw);
    this.setData({
      heroAmountDisplay: hero.text,
      heroAmountClass: hero.cls,
      netIncomeDisplay: net.text,
      netIncomeClass: net.cls,
      summaryNetIncomeDisplay: summaryNet.text,
      summaryNetIncomeClass: summaryNet.cls
    });
  },

  applyIncomeFilter() {
    const keyword = (this.data.incomeKeyword || "").trim().toLowerCase();
    const filter = this.data.incomeFilter || "month";
    const sourceItems = Array.isArray(this._incomeItems) ? this._incomeItems : [];
    const now = new Date();
    const today = formatDate(now);
    const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevMonth = this.getPrevMonth(nowMonth);
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const weekStart = formatDate(monday);

    const list = sourceItems.filter((item) => {
      const text = `${item.title} ${item.code} ${item.source}`.toLowerCase();
      if (keyword && !text.includes(keyword)) return false;

      const itemDate = (item.time || "").slice(0, 10);
      const itemMonth = itemDate.slice(0, 7);
      if (filter === "today") return itemDate === today;
      if (filter === "week") return itemDate >= weekStart;
      if (filter === "month") return itemMonth === nowMonth;
      if (filter === "lastMonth") return itemMonth === prevMonth;
      if (filter === "custom") {
        const start = this.data.incomeDateStart || "0000-01-01";
        const end = this.data.incomeDateEnd || "9999-12-31";
        return itemDate >= start && itemDate <= end;
      }
      return true;
    });

    this.setData({ filteredIncomeItems: list });
  },

  getPrevMonth(monthStr) {
    const parts = (monthStr || "2026-05").split("-");
    let year = Number(parts[0]);
    let month = Number(parts[1]);
    month -= 1;
    if (month <= 0) {
      month = 12;
      year -= 1;
    }
    return `${year}-${String(month).padStart(2, "0")}`;
  },

  onIncomeKeywordInput(e) {
    this.setData({ incomeKeyword: e.detail.value || "" }, () => this.applyIncomeFilter());
  },

  onIncomeFilterTap(e) {
    const value = e.currentTarget.dataset.filter;
    if (!value) return;
    if (value === "custom") {
      this.setData({ incomeFilter: value, showIncomeDatePanel: true }, () => this.applyIncomeFilter());
      return;
    }
    this.setData({ incomeFilter: value, showIncomeDatePanel: false }, () => this.applyIncomeFilter());
  },

  async openIncomeDetail(e) {
    const recordId = String(e.currentTarget.dataset.recordId || "").trim();
    const productId = String(e.currentTarget.dataset.productId || "").trim();
    if (!recordId) return;

    const record = (this._settlementRecordMap || {})[recordId];
    if (!record) return;

    const allSettlementItems = (record.settlementItems || []).map((item, index) => ({
      ...item,
      rowKey: item.rowKey || `${item.id || "item"}-${index}`,
      totalPrice: item.totalPrice || (item.price * item.soldQty)
    }));

    const settlementItems = allSettlementItems.filter((item) => {
      if (!productId) {
        return true;
      }
      return String(item.id || item.productId || "").trim() === productId;
    });

    const currentItem = settlementItems[0] || allSettlementItems[0] || null;
    const currentQty = toNumber(currentItem?.soldQty || 1);
    const currentGross = toNumber(currentItem?.totalPrice != null ? currentItem.totalPrice : toNumber(currentItem?.price) * currentQty);
    const currentRate = toNumber(currentItem?.rate);
    const currentCommission = currentGross * (currentRate / 100);
    const allGross = allSettlementItems.reduce((sum, item) => sum + toNumber(item.totalPrice != null ? item.totalPrice : toNumber(item.price) * toNumber(item.soldQty || 1)), 0);
    const currentActualIncome = currentItem && currentItem.actualIncome != null
      ? toNumber(currentItem.actualIncome)
      : (allGross > 0 ? (toNumber(record.actualIncome) * currentGross) / allGross : 0);

    this.setData({
      previousView: this.data.view || "income",
      settledDetail: record,
      settlementItems,
      settlementItemCount: settlementItems.length,
      settlementVouchers: [],
      settledDetailPayable: fmt2(currentItem?.payableAmount != null ? toNumber(currentItem.payableAmount) : Math.max(0, currentGross - currentCommission)),
      settledDetailGross: fmt2(currentGross),
      settledDetailCommission: fmt2(currentCommission),
      settledDetailActualIncome: fmt2(currentActualIncome),
      settledDetailRateText: `${currentRate.toFixed(0)}%`,
      settledDetailUserInitial: String(record.userNickname || "寄").slice(0, 1),
      view: "settledDetail"
    });

    const vouchers = record.vouchers || [];
    if (vouchers.length > 0) {
      try {
        const cloudIds = vouchers.filter((p) => p && p.startsWith("cloud://"));
        const tempUrls = {};

        if (cloudIds.length > 0) {
          const res = await wx.cloud.getTempFileURL({ fileList: cloudIds });
          (res.fileList || []).forEach((item) => {
            if (item.status === 0 && item.tempFileURL) {
              tempUrls[item.fileID] = item.tempFileURL;
            }
          });
        }

        const displayVouchers = vouchers.map((p) => {
          if (!p) return "";
          if (p.startsWith("cloud://")) {
            return tempUrls[p] || p;
          }
          return p;
        }).filter(Boolean);

        this.setData({ settlementVouchers: displayVouchers });
      } catch (e) {
        this.setData({ settlementVouchers: vouchers });
      }
    }
  },

  goBackFromSettledDetail() {
    this.setData({
      view: this.data.previousView || "income"
    });
  },

  async previewSettlementVoucher(e) {
    const { index } = e.currentTarget.dataset;
    const vouchers = this.data.settlementVouchers;
    if (!vouchers || !vouchers.length) return;

    wx.showLoading({ title: "加载中" });
    try {
      const cloudIds = vouchers.filter((p) => p && p.startsWith("cloud://"));
      const tempUrls = {};

      if (cloudIds.length > 0) {
        const res = await wx.cloud.getTempFileURL({ fileList: cloudIds });
        (res.fileList || []).forEach((item) => {
          if (item.status === 0 && item.tempFileURL) {
            tempUrls[item.fileID] = item.tempFileURL;
          }
        });
      }

      const previewUrls = vouchers.map((p) => {
        if (!p) return "";
        if (p.startsWith("cloud://")) {
          return tempUrls[p] || p;
        }
        return p;
      }).filter(Boolean);

      const currentUrl = previewUrls[index] || previewUrls[0];
      wx.hideLoading();

      if (previewUrls.length > 0) {
        wx.previewImage({
          current: currentUrl,
          urls: previewUrls
        });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: "图片加载失败", icon: "none" });
    }
  },

  goBackHome() {
    this.setData({ view: "home" });
  },

  goUserFromIncome(e) {
    const userId = e.currentTarget.dataset.userId || "";
    const userName = e.currentTarget.dataset.userName || "";
    navigateAdminRoot("/admin/pages/users/users", { keyword: userName || userId });
  },

  openSettlementProductDetail(e) {
    const productId = String(e.currentTarget.dataset.productId || "").trim();
    if (!productId) {
      wx.showToast({
        title: "商品信息不存在",
        icon: "none"
      });
      return;
    }

    wx.navigateTo({
      url: `/admin/pages/goods/detail/detail?id=${productId}`
    });
  },

  onIncomeStartDateChange(e) {
    this.setData({ incomeDateStart: e.detail.value || this.data.incomeDateStart });
  },

  onIncomeEndDateChange(e) {
    this.setData({ incomeDateEnd: e.detail.value || this.data.incomeDateEnd });
  },

  confirmIncomeCustomDate() {
    if (this.data.incomeDateStart > this.data.incomeDateEnd) {
      wx.showToast({ title: "开始日期不能晚于结束日期", icon: "none" });
      return;
    }
    this.setData({ showIncomeDatePanel: false, incomeFilter: "custom" }, () => this.applyIncomeFilter());
  },

  cancelIncomeCustomDate() {
    this.setData({ showIncomeDatePanel: false });
  },

  onExpenseFormDateChange(e) {
    this.setData({ expenseFormDate: e.detail.value || this.data.expenseFormDate });
  },

  onExpenseAmountInput(e) {
    this.setData({ expenseFormAmount: e.detail.value || "" });
  },

  onExpenseNoteInput(e) {
    this.setData({ expenseFormNote: e.detail.value || "" });
  },

  onExpenseMaterialItemNameInput(e) {
    this.setData({ expenseMaterialItemName: e.detail.value || "" });
  },

  onExpenseMaterialPresetTap(e) {
    const preset = e.currentTarget.dataset.preset || "";
    this.setData({
      expenseMaterialPreset: preset,
      expenseMaterialItemName: preset === "custom" ? this.data.expenseMaterialItemName : ""
    });
  },

  chooseExpenseVoucherImage() {
    const current = this.data.expenseVoucherImages || [];
    if (current.length >= 3) {
      wx.showToast({ title: "最多上传 3 张", icon: "none" });
      return;
    }
    wx.chooseImage({
      count: 3 - current.length,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const next = current.concat(res.tempFilePaths || []).slice(0, 3);
        this.setData({ expenseVoucherImages: next });
      }
    });
  },

  removeExpenseVoucherImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    const list = [...(this.data.expenseVoucherImages || [])];
    if (Number.isNaN(index) || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    this.setData({ expenseVoucherImages: list });
  },

  async submitExpenseForm() {
    const expenseType = getExpenseTypeByView(this.data.view);
    const isMaterial = expenseType === "material";
    const expenseConfig = getExpenseConfig(expenseType);
    const amount = Number(this.data.expenseFormAmount);
    const date = this.data.expenseFormDate;
    const note = (this.data.expenseFormNote || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: isMaterial ? "请填写材料支出金额" : `请填写${expenseConfig.title}金额`, icon: "none" });
      return;
    }
    if (!date) {
      wx.showToast({ title: "请选择发生日期", icon: "none" });
      return;
    }

    const now = new Date();
    const today = formatDate(now);
    if (date > today) {
      wx.showToast({ title: "发生日期不能晚于今天", icon: "none" });
      return;
    }

    if (isMaterial && !this.data.expenseMaterialPreset) {
      wx.showToast({ title: "请选择或填写支出项目", icon: "none" });
      return;
    }

    const itemName = isMaterial
      ? (this.data.expenseMaterialPreset === "custom"
        ? (this.data.expenseMaterialItemName || "").trim()
        : ({ box: "包装盒", protect: "防撞材料", bag: "透明袋", label: "标签纸" }[this.data.expenseMaterialPreset] || "其他耗材"))
      : expenseConfig.itemName;

    if (isMaterial && this.data.expenseMaterialPreset === "custom" && !itemName) {
      wx.showToast({ title: "请填写自定义项目名称", icon: "none" });
      return;
    }

    const collection = expenseConfig.collection;
    const payload = {
      amount: Number(amount.toFixed(2)),
      date,
      note,
      updatedAt: new Date()
    };

    if (isMaterial) {
      payload.itemName = itemName;
      payload.vouchers = this.data.expenseVoucherImages || [];
    }

    try {
      wx.showLoading({ title: "保存中", mask: true });
      if (this.data.expenseFormMode === "edit" && this.data.editingExpenseId) {
        await dataAccessService.updateDocById(collection, this.data.editingExpenseId, payload);
      } else {
        await dataAccessService.addDoc(collection, { ...payload, createdAt: new Date() });
      }
      await addOperationLog({
        title: this.data.expenseFormMode === "edit" ? "编辑支出" : "新增支出",
        target: expenseConfig.title,
        type: "财务",
        note: `${itemName} · ¥${payload.amount.toFixed(2)} · ${date}`
      });
      wx.showToast({ title: "保存成功", icon: "success" });

      const nextView = expenseConfig.listView;
      this.setData({
        view: nextView,
        expenseFormMode: "create",
        editingExpenseId: "",
        expenseFormAmount: "",
        expenseFormDate: "",
        expenseFormNote: "",
        expenseMaterialPreset: "",
        expenseMaterialItemName: "",
        expenseVoucherImages: []
      });

      await this.loadAllStatsData();
      this.setData({ view: nextView });
    } catch (error) {
      await addOperationLog({
        title: this.data.expenseFormMode === "edit" ? "编辑支出" : "新增支出",
        target: expenseConfig.title,
        type: "财务",
        note: formatFailureContext(error, `${itemName} · ${date || "未选日期"}`),
        success: false
      });
      console.error("submitExpenseForm error:", error);
      
      const msg = String((error && (error.errMsg || error.message)) || "");
      const errCode = Number(error && error.errCode);
      const normalized = msg.toLowerCase();
      
      if (
        errCode === -502005 ||
        normalized.includes("does not exist") ||
        normalized.includes("not exist") ||
        normalized.includes("not exists") ||
        normalized.includes("resourcenotfound") ||
        normalized.includes("db or table not exist") ||
        normalized.includes("database collection not exists")
      ) {
        wx.showModal({
          title: "需要初始化数据库",
          content: `请在微信开发者工具的云开发控制台中创建「${collection}」集合后再试。可参考 database/${collection}.schema.json 和 database/${collection}.indexes.json。`,
          showCancel: false,
          confirmText: "知道了"
        });
      } else {
        wx.showToast({ title: "保存失败，请重试", icon: "none" });
      }
    } finally {
      wx.hideLoading();
    }
  },

  switchMaterialStatMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode) return;
    this.setData({ materialStatMode: mode });
  },

  switchLogisticsStatMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode) return;
    this.setData({ logisticsStatMode: mode });
  },

  switchTechServiceStatMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode) return;
    this.setData({ techServiceStatMode: mode });
  },

  goView(e) {
    const next = e.currentTarget.dataset.view;
    if (!next) return;
    this.setData({ view: next, showMonthPanel: false });
  },

  goGoodsByStatus(e) {
    const status = e.currentTarget.dataset.status || "all";
    navigateAdminRoot("/admin/pages/goods/list/list", { status });
  },

  switchMode(e) {
    this.setData({ statMode: e.currentTarget.dataset.mode }, () => {
      this.applyModeStats();
      this.syncIncomeSigns();
    });
  },

  applyModeStats() {
    const source = this.data.statMode === "all" ? this.data.allStatsRaw : this.data.monthStatsRaw;
    if (!source) return;
    const materialItems = this.data.materialItems || [];
    const logisticsItems = this.data.logisticsItems || [];
    const techServiceItems = this.data.techServiceItems || [];
    const materialEntryNote = this.data.statMode === "all"
      ? `累计 ${this.data.materialCountAll} 笔 · ${topLabels(materialItems.map((item) => item.name || "材料"), 2).join(" / ") || "暂无记录"}`
      : this.buildExpenseEntryNote(materialItems, this.data.selectedMonth, {
          scopeLabel: "本月",
          emptyLabel: "暂无记录",
          labelGetter: (item) => item.name || "材料"
        });
    const logisticsEntryNote = this.data.statMode === "all"
      ? `累计 ${this.data.logisticsCountAll} 笔 · ${topLabels(logisticsItems.map((item) => classifyLogisticsNote(item.note)), 2).join(" / ") || "暂无记录"}`
      : this.buildExpenseEntryNote(logisticsItems, this.data.selectedMonth, {
          scopeLabel: "本月",
          emptyLabel: "暂无记录",
          labelGetter: (item) => classifyLogisticsNote(item.note)
        });
    const techServiceEntryNote = this.data.statMode === "all"
      ? `累计 ${this.data.techServiceCountAll} 笔 · ${topLabels(techServiceItems.map(() => "技术服务"), 2).join(" / ") || "暂无记录"}`
      : this.buildExpenseEntryNote(techServiceItems, this.data.selectedMonth, {
          scopeLabel: "本月",
          emptyLabel: "暂无记录",
          labelGetter: () => "技术服务"
        });
    this.setData({
      heroTitle: this.data.statMode === "all" ? "累计实际收益" : "本月实际收益",
      heroAmountRaw: source.netIncome,
      commissionIncome: fmtMoney(source.commissionTotal),
      spreadIncome: fmtSignedMoney(source.spreadTotal),
      totalExpense: fmtMoney(-source.totalExpense),
      salesGross: fmtMoney(source.settledPriceTotal),
      actualSale: fmtMoney(source.actualIncomeTotal),
      settleIncome: fmtMoney(source.payableTotal),
      netIncomeRaw: source.netIncome,
      summaryNetIncomeRaw: this.data.allStatsRaw ? this.data.allStatsRaw.netIncome : source.netIncome,
      materialTotal: fmtMoney(-source.materialTotal),
      logisticsTotal: fmtMoney(-source.logisticsTotal),
      techServiceTotal: fmtMoney(-source.techServiceTotal),
      materialEntryNote,
      logisticsEntryNote,
      techServiceEntryNote
    });
  },

  toggleMonthPanel() {
    if (this.data.statMode === "all") return;
    const willShow = !this.data.showMonthPanel;
    const selectedYear = Number((this.data.selectedMonth || "").split("-")[0]) || this.data.panelYear;
    this.setData({ showMonthPanel: willShow, panelYear: selectedYear }, () => this.rebuildMonths());
  },

  async chooseMonth(e) {
    if (e.currentTarget.dataset.disabled) return;
    const value = e.currentTarget.dataset.value;
    const selectedYear = Number(value.split("-")[0]);
    this.setData({ selectedMonth: value, panelYear: selectedYear, showMonthPanel: false }, async () => {
      this.rebuildMonths();
      await this.loadAllStatsData();
      wx.showToast({ title: `已切换至 ${selectedYear} 年 ${Number(value.split("-")[1])} 月`, icon: "none" });
    });
  },

  prevYear() {
    if (!this.data.canPrevYear) return;
    this.setData({ panelYear: Number(this.data.panelYear || 2026) - 1 }, () => this.rebuildMonths());
  },

  nextYear() {
    if (!this.data.canNextYear) return;
    this.setData({ panelYear: Number(this.data.panelYear || 2026) + 1 }, () => this.rebuildMonths());
  },

  openDeleteDialog(e) {
    const type = e.currentTarget.dataset.type || "";
    const id = e.currentTarget.dataset.id || "";
    this.setData({ showDeleteDialog: true, pendingDeleteType: type, pendingDeleteId: id });
  },

  async confirmDeleteExpense() {
    const type = this.data.pendingDeleteType;
    const id = this.data.pendingDeleteId;
    if (!type || !id) {
      this.setData({ showDeleteDialog: false });
      return;
    }

    const expenseConfig = getExpenseConfig(type);
    const collection = expenseConfig.collection;
    try {
      await dataAccessService.removeDocById(collection, id);
      await addOperationLog({
        title: "删除支出",
        target: expenseConfig.title,
        type: "财务",
        note: id
      });
      wx.showToast({ title: "删除成功", icon: "success" });
      this.setData({ showDeleteDialog: false, pendingDeleteType: "", pendingDeleteId: "" });
      await this.loadAllStatsData();
      this.setData({ view: expenseConfig.listView });
    } catch (error) {
      await addOperationLog({
        title: "删除支出",
        target: expenseConfig.title,
        type: "财务",
        note: formatFailureContext(error, id),
        success: false
      });
      console.error("confirmDeleteExpense error:", error);
      wx.showToast({ title: "删除失败", icon: "none" });
    }
  },

  onExpenseEditTap(e) {
    const id = e.currentTarget.dataset.id;
    const type = e.currentTarget.dataset.type;
    const sourceList = type === "material"
      ? (this.data.materialItems || [])
      : type === "techService"
        ? (this.data.techServiceItems || [])
        : (this.data.logisticsItems || []);
    const item = sourceList.find((row) => row.id === id);
    if (!item) return;
    const expenseConfig = getExpenseConfig(type);

    this.setData({
      view: expenseConfig.formView,
      expenseFormMode: "edit",
      editingExpenseId: item.id,
      expenseFormAmount: String(item.amountRaw || ""),
      expenseFormDate: item.date || "",
      expenseFormNote: item.note || "",
      expenseMaterialPreset: type === "material" ? getPresetFromName(item.name) : "",
      expenseMaterialItemName: type === "material" && getPresetFromName(item.name) === "custom" ? (item.name || "") : "",
      expenseVoucherImages: type === "material" ? (item.vouchers || []) : []
    });
  },

  openExpenseCreateForm(e) {
    const type = e.currentTarget.dataset.type || "material";
    const expenseConfig = getExpenseConfig(type);
    this.setData({
      view: expenseConfig.formView,
      expenseFormMode: "create",
      editingExpenseId: "",
      expenseFormAmount: "",
      expenseFormDate: formatDate(new Date()),
      expenseFormNote: "",
      expenseMaterialPreset: "",
      expenseMaterialItemName: "",
      expenseVoucherImages: []
    });
  },

  closeDeleteDialog() {
    this.setData({ showDeleteDialog: false, pendingDeleteType: "", pendingDeleteId: "" });
  },

  noop() {},

  goStats() {
    navigateAdminRoot("/admin/pages/stats/stats");
  },
  goGoods() {
    navigateAdminRoot("/admin/pages/goods/list/list");
  },
  goUsers() {
    navigateAdminRoot("/admin/pages/users/users");
  },
  goSettings() {
    navigateAdminRoot("/admin/pages/settings/settings");
  }
});
