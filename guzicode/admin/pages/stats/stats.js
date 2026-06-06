const productsRepository = require("../../../utils/productsRepository");
const { addOperationLog, formatFailureContext } = require("../../../utils/adminSettings");
const { navigateAdminRoot } = require("../../../utils/adminNavigation");

const SETTLEMENT_RECORDS_COLLECTION = "settlement_records";
const MATERIAL_EXPENSES_COLLECTION = "material_expenses";
const LOGISTICS_EXPENSES_COLLECTION = "logistics_expenses";

function db() {
  return wx.cloud.database();
}

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

Page({
  data: {
    view: "home",
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
    actualSale: "¥0.00",
    settleIncome: "¥0.00",
    netIncomeRaw: 0,
    netIncomeDisplay: "¥0.00",
    netIncomeClass: "",
    summaryNetIncomeRaw: 0,
    summaryNetIncomeDisplay: "¥0.00",
    summaryNetIncomeClass: "",

    monthStatsRaw: null,
    allStatsRaw: null,

    summaryRows: [],

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
    materialStatMode: "month",
    logisticsTotal: "-¥0.00",
    logisticsTotalAll: "-¥0.00",
    logisticsStatMode: "month",

    materialItems: [],
    logisticsItems: [],

    showDeleteDialog: false,
    pendingDeleteType: "",
    pendingDeleteId: "",

    settledDetail: null,
    settlementItems: [],
    settlementVouchers: [],
    settledDetailPayable: "0.00",
    settledDetailGross: "0.00",
    settledDetailCommission: "0.00",
    settledDetailActualIncome: "0.00"
  },

  async onShow() {
    await this.loadAllStatsData();
  },

  async fetchAll(collectionName, where = {}) {
    const pageSize = 100;
    let skip = 0;
    const result = [];
    try {
      while (true) {
        const res = await db().collection(collectionName).where(where).skip(skip).limit(pageSize).get();
        const rows = res.data || [];
        result.push(...rows);
        if (rows.length < pageSize) break;
        skip += pageSize;
      }
      return result;
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
      const [products, settlementRecords, materialRecords, logisticsRecords] = await Promise.all([
        productsRepository.getAllProducts(),
        this.fetchAll(SETTLEMENT_RECORDS_COLLECTION),
        this.fetchAll(MATERIAL_EXPENSES_COLLECTION),
        this.fetchAll(LOGISTICS_EXPENSES_COLLECTION)
      ]);

      const now = new Date();
      const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      let selectedMonth = this.data.selectedMonth || nowMonth;
      
      if (selectedMonth > nowMonth) {
        selectedMonth = nowMonth;
      }

      const statsCount = this.computeProductCounts(products || []);
      const monthStatsRaw = this.computeStatsByMonth(settlementRecords, materialRecords, logisticsRecords, selectedMonth);
      const allStatsRaw = this.computeStatsAll(settlementRecords, materialRecords, logisticsRecords);
      const summaryRows = this.buildSummaryRows(allStatsRaw);

      const incomeItems = this.buildIncomeItems(settlementRecords || []);
      const materialItems = this.buildMaterialItems(materialRecords || []);
      const logisticsItems = this.buildLogisticsItems(logisticsRecords || []);

      this.setData({
        ...statsCount,
        selectedMonth,
        panelYear: Number((selectedMonth || nowMonth).split("-")[0]),
        maxYear: now.getFullYear(),
        monthStatsRaw,
        allStatsRaw,
        summaryRows,
        incomeItems,
        materialItems,
        logisticsItems,
        incomeDateStart: `${selectedMonth}-01`,
        incomeDateEnd: `${selectedMonth}-31`,
        materialCountAll: materialItems.length,
        materialCountMonth: materialItems.filter((item) => getMonthKey(item.date) === selectedMonth).length,
        materialTotalAll: fmtMoney(-allStatsRaw.materialTotal),
        materialTotal: fmtMoney(-monthStatsRaw.materialTotal),
        logisticsTotal: fmtMoney(-monthStatsRaw.logisticsTotal),
        logisticsTotalAll: fmtMoney(-allStatsRaw.logisticsTotal),
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
      upCount: products.filter((item) => item.status === "up").length,
      soldCount: products.filter((item) => item.status === "sold").length,
      settledCount: products.filter((item) => item.status === "settled").length
    };
  },

  computeStatsByMonth(settlementRecords = [], materialRecords = [], logisticsRecords = [], monthKey) {
    const settled = settlementRecords.filter((item) => getMonthKey(item.date) === monthKey);
    const material = materialRecords.filter((item) => getMonthKey(item.date) === monthKey);
    const logistics = logisticsRecords.filter((item) => getMonthKey(item.date) === monthKey);
    return this.computeStatsCore(settled, material, logistics);
  },

  computeStatsAll(settlementRecords = [], materialRecords = [], logisticsRecords = []) {
    return this.computeStatsCore(settlementRecords, materialRecords, logisticsRecords);
  },

  computeStatsCore(settlementRecords = [], materialRecords = [], logisticsRecords = []) {
    const settledPriceTotal = settlementRecords.reduce((sum, item) => sum + toNumber(item.gross), 0);
    const actualIncomeTotal = settlementRecords.reduce((sum, item) => sum + toNumber(item.actualIncome), 0);
    const commissionTotal = settlementRecords.reduce((sum, item) => sum + toNumber(item.commission), 0);
    const payableTotal = settlementRecords.reduce((sum, item) => sum + toNumber(item.payable), 0);
    const spreadTotal = actualIncomeTotal - settledPriceTotal;

    const materialTotal = materialRecords.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const logisticsTotal = logisticsRecords.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const totalExpense = materialTotal + logisticsTotal;
    const netIncome = commissionTotal + spreadTotal - totalExpense;

    return {
      settledPriceTotal,
      actualIncomeTotal,
      commissionTotal,
      payableTotal,
      spreadTotal,
      materialTotal,
      logisticsTotal,
      totalExpense,
      netIncome
    };
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
      { label: "物流费用总支出", note: "Σ 物流支出", value: fmtMoney(-allStats.logisticsTotal), negative: true }
    ];
  },

  buildIncomeItems(settlementRecords = []) {
    const rows = [];
    settlementRecords.forEach((record) => {
      const list = record.settlementItems || [];
      const grossTotal = toNumber(record.gross) || 1;
      const actualIncomeTotal = toNumber(record.actualIncome);
      list.forEach((item) => {
        const qty = toNumber(item.soldQty || 1);
        const price = toNumber(item.price);
        const gross = price * qty;
        const ratio = grossTotal ? gross / grossTotal : 0;
        const settleAmount = actualIncomeTotal * ratio;
        const rate = toNumber(item.rate);
        const commission = gross * (rate / 100);

        rows.push({
          id: `${record._id || record.id || record.date}-${item.id || item.productId || Math.random()}`,
          productId: item.id || item.productId || "",
          settlementRecordId: record._id || record.id || "",
          settlementRecord: record,
          title: item.role || item.series || item.ip || item.id || "已结算商品",
          code: `${item.id || ""} · ${record.userNickname || ""}`.trim(),
          userId: record.userId || "",
          userNickname: record.userNickname || "未知用户",
          userAccount: record.userAccount || "",
          price: fmtMoney(gross),
          income: fmtMoney(settleAmount),
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
    const now = new Date();
    const today = formatDate(now);
    const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevMonth = this.getPrevMonth(nowMonth);
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const weekStart = formatDate(monday);

    const list = (this.data.incomeItems || []).filter((item) => {
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
    const recordId = e.currentTarget.dataset.recordId;
    const incomeItem = this.data.incomeItems?.find(item => item.settlementRecordId === recordId);
    const record = incomeItem?.settlementRecord;
    if (!record) return;

    const settlementItems = (record.settlementItems || []).map((item, index) => ({
      ...item,
      rowKey: item.rowKey || `${item.id || "item"}-${index}`,
      totalPrice: item.totalPrice || (item.price * item.soldQty)
    }));
    const subtitle = `${record.date} · 共 ${record.items} 件商品`;

    this.setData({
      settledDetail: record,
      settlementItems,
      settlementVouchers: [],
      settledDetailPayable: fmt2(record.payable),
      settledDetailGross: fmt2(record.gross),
      settledDetailCommission: fmt2(record.commission),
      settledDetailActualIncome: fmt2(record.actualIncome),
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
    const isMaterial = this.data.view === "materialForm";
    const amount = Number(this.data.expenseFormAmount);
    const date = this.data.expenseFormDate;
    const note = (this.data.expenseFormNote || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: isMaterial ? "请填写材料支出金额" : "请填写物流支出金额", icon: "none" });
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
      : "物流支出";

    if (isMaterial && this.data.expenseMaterialPreset === "custom" && !itemName) {
      wx.showToast({ title: "请填写自定义项目名称", icon: "none" });
      return;
    }

    const collection = isMaterial ? MATERIAL_EXPENSES_COLLECTION : LOGISTICS_EXPENSES_COLLECTION;
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
        await db().collection(collection).doc(this.data.editingExpenseId).update({ data: payload });
      } else {
        await db().collection(collection).add({ data: { ...payload, createdAt: new Date() } });
      }
      await addOperationLog({
        title: this.data.expenseFormMode === "edit" ? "编辑支出" : "新增支出",
        target: isMaterial ? "材料支出" : "物流支出",
        type: "财务",
        note: `${itemName} · ¥${payload.amount.toFixed(2)} · ${date}`
      });
      wx.showToast({ title: "保存成功", icon: "success" });

      const nextView = isMaterial ? "material" : "logistics";
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
        target: isMaterial ? "材料支出" : "物流支出",
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
          content: `请在微信开发者工具的云开发控制台中创建「${collection}」集合后再试。`,
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

  goView(e) {
    const next = e.currentTarget.dataset.view;
    if (!next) return;
    this.setData({ view: next, showMonthPanel: false });
  },

  goGoodsByStatus(e) {
    const status = e.currentTarget.dataset.status || "all";
    navigateAdminRoot("/admin/pages/goods/list/list", { status });
  },

  goBackHome() {
    this.setData({ view: "home" });
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
    this.setData({
      heroTitle: this.data.statMode === "all" ? "累计实际收益" : "本月实际收益",
      heroAmountRaw: source.netIncome,
      commissionIncome: fmtMoney(source.commissionTotal),
      spreadIncome: fmtSignedMoney(source.spreadTotal),
      totalExpense: fmtMoney(-source.totalExpense),
      actualSale: fmtMoney(source.settledPriceTotal),
      settleIncome: fmtMoney(source.actualIncomeTotal),
      netIncomeRaw: source.netIncome,
      summaryNetIncomeRaw: this.data.allStatsRaw ? this.data.allStatsRaw.netIncome : source.netIncome,
      materialTotal: fmtMoney(-source.materialTotal),
      logisticsTotal: fmtMoney(-source.logisticsTotal)
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

    const collection = type === "material" ? MATERIAL_EXPENSES_COLLECTION : LOGISTICS_EXPENSES_COLLECTION;
    try {
      await db().collection(collection).doc(id).remove();
      await addOperationLog({
        title: "删除支出",
        target: type === "material" ? "材料支出" : "物流支出",
        type: "财务",
        note: id
      });
      wx.showToast({ title: "删除成功", icon: "success" });
      this.setData({ showDeleteDialog: false, pendingDeleteType: "", pendingDeleteId: "" });
      await this.loadAllStatsData();
      this.setData({ view: type === "material" ? "material" : "logistics" });
    } catch (error) {
      await addOperationLog({
        title: "删除支出",
        target: type === "material" ? "材料支出" : "物流支出",
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
    const sourceList = type === "material" ? (this.data.materialItems || []) : (this.data.logisticsItems || []);
    const item = sourceList.find((row) => row.id === id);
    if (!item) return;

    this.setData({
      view: type === "material" ? "materialForm" : "logisticsForm",
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
    this.setData({
      view: type === "material" ? "materialForm" : "logisticsForm",
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
