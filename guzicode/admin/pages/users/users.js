const PRODUCTS_COLLECTION = "products";
const SETTLEMENT_RECORDS_COLLECTION = "settlement_records";
const { addOperationLog, formatFailureContext } = require("../../../utils/adminSettings");
const { navigateAdminRoot } = require("../../../utils/adminNavigation");
const { debounce } = require("../../../utils/debounce");
const { getUserRateFraction, normalizeRateFraction, normalizeSoldBatches } = require("../../../utils/consignmentRate");
const { buildPendingSettlementItems } = require("../../../utils/settlementPresentation");
const { ensureCloudImages } = require("../../../utils/cloudFile");
const dataAccessService = require("../../../utils/dataAccessService");
const productsRepository = require("../../../utils/productsRepository");
const usersRepository = require("../../../utils/usersRepository");
const authService = require("../../../utils/authService");
const session = require("../../../utils/session");

const POSTER_CANVAS_WIDTH = 620;
const POSTER_CARD_WIDTH = 510;
const POSTER_PADDING = 38;
const POSTER_FIRST_PAGE_LIMIT = 4;
const POSTER_NEXT_PAGE_LIMIT = 6;

function fmt2(value) {
  return Number(value || 0).toFixed(2);
}

function calcPayableAmount(price, quantity, rateFraction) {
  const grossAmount = Number(price || 0) * Number(quantity || 0);
  const commissionAmount = grossAmount * normalizeRateFraction(rateFraction);
  return grossAmount - commissionAmount;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateTimeLabel(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatCompactDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function buildDraftSettlementNo(user, now = Date.now()) {
  const datePart = formatCompactDate(now);
  const userPart = String((user && (user.id || user._id || user.account)) || "").replace(/\W/g, "").slice(-4).padStart(4, "0");
  return `JS${datePart}${userPart}`;
}

function formatDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffDaysFromNow(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  const diff = now - date.getTime();
  return diff >= 0 ? Math.floor(diff / (24 * 60 * 60 * 1000)) : 0;
}

function pickLastActiveAt(user) {
  return (
    user.lastLoginAt ||
    user.lastLoginTime ||
    user.lastLoginDate ||
    user.lastSignInAt ||
    user.loginAt ||
    null
  );
}

function roleTypeFromUser(user) {
  if (user.role === "consignment_user" || user.isAgentEnabled) return "consignment";
  return "normal";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function productBelongsToUser(product, user) {
  if (!product || !user) {
    return false;
  }

  const productOwnerUserId = normalizeText(product.ownerUserId);
  const userId = normalizeText(user.id || user._id);
  if (productOwnerUserId && userId && productOwnerUserId === userId) {
    return true;
  }

  const productOwner = normalizeText(product.owner);
  if (!productOwner) {
    return false;
  }

  const userNickname = normalizeText(user.nickname || user.name);
  const userAccount = normalizeText(user.account);
  const userIdText = normalizeText(user.id || user._id);
  
  // 额外匹配：商品 owner 匹配用户的 id 字段
  if (userIdText && productOwner === userIdText) {
    return true;
  }

  return Boolean(
    (userNickname && productOwner === userNickname)
    || (userAccount && productOwner === userAccount)
  );
}

function canDeleteUser(user) {
  return !!(user && user.id);
}

function normalizeMoneyValue(value) {
  return Number(value || 0).toFixed(2);
}

function buildSettlementItemFingerprint(item) {
  return JSON.stringify({
    productId: String((item && (item.productId || item.id)) || "").trim(),
    batchIndex: Number(item && item.batchIndex),
    soldQty: Number(item && item.soldQty || 0),
    price: normalizeMoneyValue(item && item.price),
    saleAmount: normalizeMoneyValue(item && item.saleAmount),
    payableAmount: normalizeMoneyValue(item && item.payableAmount),
    rateFraction: normalizeMoneyValue(normalizeRateFraction(item && item.rateFraction))
  });
}

function buildSettlementRecordFingerprint(record) {
  const items = Array.isArray(record && record.settlementItems) ? record.settlementItems : [];
  const sortedItems = items
    .map((item) => buildSettlementItemFingerprint(item))
    .sort();

  return JSON.stringify({
    userId: String(record && record.userId || "").trim(),
    date: String(record && record.date || "").trim(),
    month: String(record && record.month || "").trim(),
    items: Number(record && record.items || 0),
    gross: normalizeMoneyValue(record && record.gross),
    commission: normalizeMoneyValue(record && record.commission),
    payable: normalizeMoneyValue(record && record.payable),
    actualIncome: normalizeMoneyValue(record && record.actualIncome),
    settlementItems: sortedItems
  });
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64,
    submitting: false,
    viewTabs: [
      { id: "userList", label: "用户列表" },
      { id: "userDetail", label: "用户详情" },
      { id: "userDetailSaved", label: "详情已保存" },
      { id: "userGoods", label: "用户商品" },
      { id: "userGoodsFilters", label: "筛选下拉" },
      { id: "soldGoods", label: "待结算" },
      { id: "settlement", label: "结算" },
      { id: "settledList", label: "已结算" },
      { id: "settledDetail", label: "结算详情" },
      { id: "confirmDialog", label: "确认弹窗" },
      { id: "emptyUser", label: "空态" }
    ],
    currentView: "userList",
    // 用户商品筛选
    userGoodsStatusOptions: ["全部状态", "已上架", "已下架", "已售出", "已结算"],
    userGoodsStatusIndex: 0,
    activeDropdown: null,
    filteredUserGoodsItems: [],
    loadingUsers: true,
    usersLoaded: false,
    viewTitle: "用户管理",
    viewSubtitle: "",
    roleOptions: ["全部用户", "寄售用户", "普通用户"],
    inactiveOptions: ["未登录时长", "30天", "60天", "90天", "120天", "365天"],
    selectedRoleIndex: 0,
    selectedInactiveIndex: 0,
    showRoleDropdown: false,
    showInactiveDropdown: false,
    multiSelect: false,
    selectedUserIds: [],
    allSelectableChecked: false,
    keyword: "",
    users: [],
    filteredUsers: [],
    currentUser: null,
    userGoodsItems: [],
    networkOnline: true,
    pageError: "",
    soldItems: [],
    selectedSoldCount: 0,
    soldTotalPayable: "0.00",
    settlementItems: [],
      settlementGross: "0.00",
      settlementCommission: "0.00",
      settlementPayable: "0.00",
      settlementActualIncome: "",
      settlementVouchers: [],
      settledRecords: [],
    settledDetail: null,
    settledDetailPayable: "0.00",
    settledDetailGross: "0.00",
    settledDetailCommission: "0.00",
    settledDetailActualIncome: "0.00",
    settledTotalPayable: "0.00",
    settledTotalItems: 0,
    settledTotalTimes: 0,
    generatingSettlementPoster: false,
    showSettlementPosterPreview: false,
    settlementPosterImages: [],
    settlementPosterCurrent: 0,
    settlementPosterOrderNo: "",
    settlementPosterDateText: "",
    posterCanvasWidth: POSTER_CANVAS_WIDTH,
    posterCanvasHeight: 1200,
    isEditing: false,
    editingField: null,
    tempData: { nickname: "", contact: "", rate: "" },
    errors: { nickname: "", contact: "", rate: "" },
    showConfirmDialog: false,
    dialogType: "",
    dialogTitle: "",
    dialogContent: "",
    dialogConfirmText: "",
    dialogCancelText: "取消",
    _pageAlive: true,
    _onLoadCompleted: false
  },

  async onLoad(options = {}) {
    this.handleBack = debounce(this.handleBack.bind(this), 500);
    this.switchView = debounce(this.switchView.bind(this), 500);
    this.saveEdit = debounce(this.saveEdit.bind(this), 800);
    this.submitSettlement = debounce(this.submitSettlement.bind(this), 800);
    this.handleBatchDeleteUsers = debounce(this.handleBatchDeleteUsers.bind(this), 800);
    
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
    this.setData({ statusBarHeight, navBarHeight, contentPaddingTop, _pageAlive: true });
    this.bindNetworkStatus();
    await this.migrateProductOwnerLinks();
    await this.loadUsersFromDb();
    const keyword = String(options.keyword || "").trim();
    if (keyword) {
      this.setData({ keyword });
      this.applyRoleFilter();
    }
    this.setData(this.getViewCopy(this.data.currentView));
    await this.restoreViewFromOptions(options);
    this.setData({ _onLoadCompleted: true });
  },

  onUnload() {
    this.setData({ _pageAlive: false });
    if (this._networkStatusHandler && wx.offNetworkStatusChange) {
      wx.offNetworkStatusChange(this._networkStatusHandler);
    }
    this._networkStatusHandler = null;
    this._networkStatusBound = false;
  },

  onHide() {
    this.setData({ _pageAlive: false });
  },

  onShow() {
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
    this.setData({ statusBarHeight, navBarHeight, contentPaddingTop, _pageAlive: true });
    // 只有在 onLoad 完成后才刷新数据，避免首次加载时重复调用
    if (this.data._onLoadCompleted) {
      this.refreshData();
    }
  },

  async refreshData() {
    // 刷新用户数据和统计
    await this.loadUsersFromDb();
    // 如果当前有选中的用户，重新加载该用户的详细数据
    if (this.data.currentUser && this.data.currentView !== 'userList') {
      const updatedUser = this.data.users.find((u) => u.id === this.data.currentUser.id) || null;
      if (updatedUser) {
        this.setData({ currentUser: updatedUser });
      }
      // 根据当前视图重新加载对应数据
      if (this.data.currentView === 'userGoods') {
        await this.loadUserGoodsForCurrentUser();
      } else if (this.data.currentView === 'soldGoods') {
        await this.loadSoldItemsForCurrentUser();
      } else if (this.data.currentView === 'settledList') {
        await this.loadSettledRecordsForCurrentUser();
      } else if (this.data.currentView === 'userDetail') {
        await this.refreshCurrentUserDetailStats();
      }
    }
  },

  bindNetworkStatus() {
    if (this._networkStatusHandler && wx.offNetworkStatusChange) {
      wx.offNetworkStatusChange(this._networkStatusHandler);
    }
    wx.getNetworkType({
      success: (res) => {
        const online = res.networkType && res.networkType !== "none";
        this._lastNetworkOnline = !!online;
        this._networkStatusReady = true;
        this.setData({ networkOnline: online });
      }
    });
    this._networkStatusHandler = (res) => {
      const online = !!res.isConnected;
      const prevOnline = typeof this._lastNetworkOnline === "boolean" ? this._lastNetworkOnline : null;
      this._lastNetworkOnline = online;
      this.setData({ networkOnline: online });
      if (!this._networkStatusReady) {
        this._networkStatusReady = true;
        return;
      }
      if (prevOnline === online) {
        return;
      }
      if (!online) {
        wx.showToast({ title: "网络已断开", icon: "none" });
      } else {
        wx.showToast({ title: "网络已恢复", icon: "none" });
      }
    };
    wx.onNetworkStatusChange(this._networkStatusHandler);
    this._networkStatusBound = true;
  },

  getFriendlyErrorMessage(error, fallback = "操作失败，请稍后重试") {
    const msg = String((error && (error.errMsg || error.message)) || "");
    if (!this.data.networkOnline || /network|timeout|fail/i.test(msg)) return "网络异常，请检查网络后重试";
    if (/permission|auth|denied/i.test(msg)) return "暂无操作权限，请联系管理员";
    if (/collection|not exist|db/i.test(msg)) return "数据集合未初始化，请先创建云数据库集合";
    return fallback;
  },

  handlePageError(error, fallback) {
    const message = this.getFriendlyErrorMessage(error, fallback);
    this.setData({ pageError: message });
    wx.showToast({ title: message, icon: "none" });
  },

  clearPageError() {
    if (this.data.pageError) this.setData({ pageError: "" });
  },

  async migrateProductOwnerLinks() {
    try {
      const [users, products] = await Promise.all([
        usersRepository.listUsers(),
        this.fetchAll(PRODUCTS_COLLECTION)
      ]);
      const idByAccount = {};
      const idByNickname = {};
      users.forEach((u) => {
        const account = String(u.account || "").trim();
        const nickname = String(u.nickname || "").trim();
        if (account) idByAccount[account] = u._id;
        if (nickname) idByNickname[nickname] = u._id;
      });
      const targets = products.filter((p) => !p.ownerUserId && p.owner);
      if (!targets.length) return;
      await Promise.all(
        targets.map((p) => {
          const owner = String(p.owner || "").trim();
          const ownerUserId = idByNickname[owner] || idByAccount[owner] || "";
          if (!ownerUserId) return Promise.resolve();
          return dataAccessService.updateDocById(PRODUCTS_COLLECTION, p._id, {
            ownerUserId,
            updatedAt: new Date()
          });
        })
      );
    } catch (e) {
      console.warn("migrateProductOwnerLinks skipped:", e && e.message);
    }
  },

  async fetchAll(collectionName, where = null) {
    return dataAccessService.fetchAll(collectionName, { where });
  },

  async loadUsersFromDb() {
    this.setData({ loadingUsers: true });
    try {
      this.clearPageError();
      const rawUsers = await usersRepository.listUsers();
      const users = rawUsers
        .map((u) => {
          const roleType = roleTypeFromUser(u);
          const nickname = String(u.nickname || "").trim() || String(u.account || "").trim();
          const ratePercent = Math.round(Number(u.platformRate || 0) * 100);
          const lastActiveAt = pickLastActiveAt(u);
          const lastLoginText = formatDateLabel(lastActiveAt);
          const inactiveDays = diffDaysFromNow(lastActiveAt);
          return {
            ...u,
            id: u._id,
            roleType,
            initial: nickname ? nickname.charAt(0) : "用",
            name: nickname,
            nickname,
            account: String(u.account || ""),
            contact: String(u.contactWechat || u.contactMobile || ""),
            rate: Number.isFinite(ratePercent) ? ratePercent : 0,
            canConsign: !!u.isAgentEnabled,
            goodsCount: 0,
            soldCount: 0,
            settledCount: 0,
            metaTop: `账号 ${String(u.account || "-")}`,
            metaBottom: lastLoginText ? `最后一次登录时间 ${lastLoginText}` : "最后一次登录时间 暂无记录",
            lastLoginText,
            lastActiveAt,
            inactiveDays,
            badge: roleType === "consignment" ? "寄售" : "普通",
            badgeClass: roleType === "consignment" ? "status-pill" : "status-pill status-pill--normal",
            cardClass: roleType === "consignment" ? "list-card--consignment" : "list-card--normal"
          };
        });
      const selectedUserIds = this.data.selectedUserIds.filter((id) => users.some((item) => item.id === id));
      this.setData({ users, selectedUserIds, loadingUsers: false, usersLoaded: true });
      await this.refreshUserStats();
      this.applyRoleFilter();
    } catch (e) {
      this.setData({ loadingUsers: false });
      this.handlePageError(e, "用户数据加载失败");
      console.error("loadUsersFromDb error:", e);
    }
  },

  async restoreViewFromOptions(options = {}) {
    const userId = String(options.userId || "").trim();
    const target = String(options.view || "").trim();
    if (!userId) {
      return;
    }

    const user = (this.data.users || []).find((item) => item.id === userId) || null;
    if (!user) {
      return;
    }

    this.setData({
      currentUser: user
    });

    if (target === "userGoods") {
      this.setData({
        currentView: "userGoods",
        ...this.getViewCopy("userGoods")
      });
      await this.loadUserGoodsForCurrentUser();
      return;
    }

    if (target === "soldGoods") {
      this.setData({
        currentView: "soldGoods",
        ...this.getViewCopy("soldGoods")
      });
      await this.loadSoldItemsForCurrentUser();
      return;
    }

    if (target === "settledList") {
      this.setData({
        currentView: "settledList",
        ...this.getViewCopy("settledList")
      });
      await this.loadSettledRecordsForCurrentUser();
      return;
    }

    this.setData({
      currentView: "userDetail",
      ...this.getViewCopy("userDetail")
    });
  },

  async refreshUserStats() {
    const products = await this.fetchAll(PRODUCTS_COLLECTION);
    console.log("[refreshUserStats] Total products:", products.length);
    
    const users = (this.data.users || []).map((user) => {
      const matched = products.filter((p) => productBelongsToUser(p, user));
      if (user.roleType === "consignment" && matched.length > 0) {
        console.log("[refreshUserStats] User:", user.nickname, "| matched products:", matched.length, "| owner values:", matched.map(p => ({ owner: p.owner, ownerUserId: p.ownerUserId })));
      }
      if (user.roleType === "consignment" && matched.length === 0) {
        console.log("[refreshUserStats] User with 0 products:", user.nickname, "| user.id:", user.id, "| user.account:", user.account);
        const sampleOwners = products.slice(0, 3).map(p => ({ owner: p.owner, ownerUserId: p.ownerUserId, id: p.id }));
        console.log("[refreshUserStats] Sample products:", JSON.stringify(sampleOwners));
      }
      const goodsCount = matched.reduce((s, p) => s + Number(p.totalQuantity || 0), 0);
      const soldCount = matched.reduce((s, p) => s + Math.max(0, Number(p.soldCount || 0) - Number(p.settledCount || 0)), 0);
      const settledCount = matched.reduce((s, p) => s + Number(p.settledCount || 0), 0);
      return { ...user, goodsCount, soldCount, settledCount };
    });
    this.setData({ users });
    if (this.data.currentUser) {
      const currentUser = users.find((u) => u.id === this.data.currentUser.id) || null;
      this.setData({ currentUser });
    }
  },

  async refreshCurrentUserDetailStats() {
    const currentUser = this.data.currentUser;
    if (!currentUser || !currentUser.id) {
      return;
    }

    await this.loadUsersFromDb();
    const latestUser = (this.data.users || []).find((item) => item.id === currentUser.id) || null;
    if (!latestUser) {
      return;
    }

    const settledRecords = await this.fetchAll(SETTLEMENT_RECORDS_COLLECTION, { userId: currentUser.id });
    const settledCount = settledRecords.reduce((sum, item) => sum + Number(item.items || 0), 0);
    const mergedUser = {
      ...latestUser,
      settledCount
    };
    const users = (this.data.users || []).map((item) => (
      item.id === mergedUser.id ? mergedUser : item
    ));

    this.setData({
      users,
      currentUser: mergedUser,
      currentView: "userDetail",
      ...this.getViewCopy("userDetail")
    });
  },

  async switchView(event) {
    const target = event.currentTarget.dataset.target;
    const userId = event.currentTarget.dataset.userId;
    if (userId) {
      const user = this.data.users.find((u) => u.id === userId) || null;
      this.setData({ currentUser: user });
    }
    this.setData({
      currentView: target,
      showRoleDropdown: false,
      showInactiveDropdown: false,
      isEditing: false,
      editingField: null,
      ...this.getViewCopy(target)
    });

    if (target === "userGoods") await this.loadUserGoodsForCurrentUser();
    if (target === "soldGoods") await this.loadSoldItemsForCurrentUser();
    if (target === "settledList") await this.loadSettledRecordsForCurrentUser();
  },

  openUserDetailById(userId) {
    const user = this.data.users.find((u) => u.id === userId) || null;
    this.setData({
      currentUser: user,
      currentView: "userDetail",
      showRoleDropdown: false,
      showInactiveDropdown: false,
      isEditing: false,
      editingField: null,
      ...this.getViewCopy("userDetail")
    });
    this.refreshCurrentUserDetailStats();
  },

  handleUserCardTap(event) {
    const userId = event.currentTarget.dataset.userId;
    if (!userId) return;
    if (this.data.multiSelect) {
      this.toggleUserSelectionById(userId);
      return;
    }
    this.openUserDetailById(userId);
  },

  getGoodsStatusMeta(product) {
    const total = Number(product.totalQuantity || 0);
    const sold = Number(product.soldCount || 0);
    const settled = Number(product.settledCount || 0);
    const remaining = total - sold;
    if (remaining <= 0 && total > 0) {
      if (settled > 0 && sold <= 0) {
        return { key: "settled", label: "已结算", className: "goods-status-pill--settled" };
      }
      return { key: "sold", label: "已售出", className: "goods-status-pill--sold" };
    }
    if (product.status === "up" || product.status === "down") {
      return product.status === "up"
        ? { key: "up", label: "已上架", className: "goods-status-pill--up" }
        : { key: "down", label: "已下架", className: "goods-status-pill--down" };
    }
    return { key: "up", label: "已上架", className: "goods-status-pill--up" };
  },

  async loadUserGoodsForCurrentUser() {
    const user = this.data.currentUser;
    if (!user) return;
    const products = (await this.fetchAll(PRODUCTS_COLLECTION)).filter((p) => productBelongsToUser(p, user));
    // 按 _id 去重，避免重复显示
    const uniqueProductsMap = new Map();
    products.forEach(p => {
      if (p._id) {
        uniqueProductsMap.set(p._id, p);
      }
    });
    const uniqueProducts = Array.from(uniqueProductsMap.values());
    
    const userGoodsItems = uniqueProducts.map((p) => {
      const statusMeta = this.getGoodsStatusMeta(p);
      const totalQuantity = Number(p.totalQuantity || 0);
      const soldCount = Number(p.soldCount || 0);
      const remainQuantity = totalQuantity - soldCount;
      const coverImage = Array.isArray(p.images) ? (p.images[0] || "") : "";
      
      return {
        id: p.id || p._id,
        title: `${p.role || ""} · ${p.series || ""}`.trim(),
        owner: p.owner || "-",
        ip: p.ip || "-",
        totalQuantity,
        remainQuantity: remainQuantity > 0 ? remainQuantity : 0,
        type: p.customType || p.type || "-",
        series: p.series || "-",
        price: Number(p.price || 0),
        qualityLabel: p.quality === "flaw" ? "有瑕" : "无瑕",
        quality: p.quality || "clean",
        statusLabel: statusMeta.label,
        statusClass: statusMeta.className,
        statusKey: statusMeta.key || p.status,
        coverImage,
        status: p.status
      };
    });
    this.setData({
      userGoodsItems,
      viewSubtitle: `${userGoodsItems.length} 件`
    });
    this.applyUserGoodsFilter();
  },

  async handleBack() {
    if (this.data.isEditing) {
      this.cancelEdit();
      return;
    }
    if (this.data.currentView === "settlement") {
      await this.loadSoldItemsForCurrentUser();
      this.setData({ currentView: "soldGoods", ...this.getViewCopy("soldGoods") });
      return;
    }
    if (this.data.currentView === "settledDetail") {
      this.setData({ currentView: "settledList", ...this.getViewCopy("settledList") });
      return;
    }
    if (this.data.currentView === "userGoods" || this.data.currentView === "soldGoods" || this.data.currentView === "settledList") {
      await this.refreshCurrentUserDetailStats();
      return;
    }
    this.setData({
      currentView: "userList",
      showRoleDropdown: false,
      showInactiveDropdown: false,
      currentUser: null,
      ...this.getViewCopy("userList")
    });
    await this.loadUsersFromDb();
  },

  goGoodsDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    wx.navigateTo({
      url: `/admin/pages/goods/detail/detail?id=${id}`
    });
  },

  handleEditProfile() {
    const user = this.data.currentUser;
    if (!user) return;
    this.setData({
      isEditing: true,
      editingField: "all",
      tempData: { nickname: user.nickname, contact: user.contact, rate: String(user.rate) },
      errors: { nickname: "", contact: "", rate: "" }
    });
  },

  startEdit(event) {
    const field = event.currentTarget.dataset.field;
    const user = this.data.currentUser;
    this.setData({
      isEditing: true,
      editingField: field,
      tempData: { nickname: user.nickname, contact: user.contact, rate: String(user.rate) },
      errors: { nickname: "", contact: "", rate: "" }
    });
  },

  cancelEdit() {
    this.setData({
      isEditing: false,
      editingField: null,
      tempData: { nickname: "", contact: "", rate: "" },
      errors: { nickname: "", contact: "", rate: "" }
    });
  },

  onInputChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({ [`tempData.${field}`]: value, [`errors.${field}`]: "" });
  },

  async saveEdit() {
    const { editingField, tempData, currentUser } = this.data;
    if (!currentUser) return;
    let hasError = false;
    const errors = { nickname: "", contact: "", rate: "" };
    if (editingField === "all" || editingField === "nickname") {
      const nickname = tempData.nickname.trim();
      if (!nickname) {
        hasError = true;
        errors.nickname = "请填写用户昵称";
      }
    }
    if (editingField === "all" || editingField === "contact") {
      const contact = tempData.contact.trim();
      if (contact && contact.length > 50) {
        hasError = true;
        errors.contact = "联系方式字数不能超过 50 个";
      }
    }
    if ((editingField === "all" || editingField === "rate") && currentUser.roleType === "consignment") {
      const rateNum = Number(tempData.rate);
      if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
        hasError = true;
        errors.rate = "请填写 0-100";
      }
    }
    if (hasError) {
      this.setData({ errors });
      return;
    }
    await this.doSaveEdit();
  },

  async doSaveEdit() {
    const { tempData, currentUser } = this.data;
    try {
      this.clearPageError();
      const nextRateFraction = currentUser.roleType === "consignment"
        ? normalizeRateFraction(Number(tempData.rate || 0) / 100)
        : null;
      const previousRateFraction = currentUser.roleType === "consignment"
        ? getUserRateFraction(currentUser)
        : null;
      if (
        currentUser.roleType === "consignment" &&
        previousRateFraction !== null &&
        nextRateFraction !== null &&
        Math.abs(previousRateFraction - nextRateFraction) > 0.000001
      ) {
        const products = await this.fetchAll(PRODUCTS_COLLECTION);
        const ownedProducts = products.filter((item) => productBelongsToUser(item, currentUser));
        await Promise.all(
          ownedProducts.map(async (product) => {
            const pendingQty = Math.max(0, Number(product.soldCount || 0) - Number(product.settledCount || 0));
            if (!pendingQty) {
              return;
            }
            const nextBatches = ensurePendingSoldBatches(product, previousRateFraction);
            await dataAccessService.updateDocById(PRODUCTS_COLLECTION, product._id, {
              soldBatches: nextBatches,
              updatedAt: new Date()
            });
          })
        );
      }
      const updateData = {
        nickname: tempData.nickname.trim(),
        contactWechat: tempData.contact.trim(),
        updatedAt: new Date()
      };
      if (currentUser.roleType === "consignment") {
        updateData.platformRate = Number(tempData.rate || 0) / 100;
      }
      await usersRepository.adminUpdateUserProfile(currentUser.id, {
        nickname: updateData.nickname,
        contactWechat: updateData.contactWechat,
        platformRate: updateData.platformRate
      });
      if (!this.data._pageAlive) return;
      await addOperationLog({
        title: "编辑用户资料",
        target: currentUser.account || currentUser.id,
        type: "用户",
        note: `${updateData.nickname} · ${currentUser.roleType === "consignment" ? `抽成 ${tempData.rate}%` : "普通用户"}`
      });
      if (!this.data._pageAlive) return;
      wx.showToast({ title: "保存成功", icon: "success" });
      this.setData({
        isEditing: false,
        editingField: null,
        tempData: { nickname: "", contact: "", rate: "" },
        errors: { nickname: "", contact: "", rate: "" }
      });
      if (!this.data._pageAlive) return;
      await this.loadUsersFromDb();
      if (!this.data._pageAlive) return;
      const user = this.data.users.find((u) => u.id === currentUser.id) || null;
      this.setData({ currentUser: user });
    } catch (e) {
      const message = String((e && (e.userMessage || e.message)) || "").trim();
      if (e && (e.code === "NICKNAME_EXISTS" || e.code === "INVALID_NICKNAME")) {
        this.setData({
          errors: {
            ...this.data.errors,
            nickname: message || "昵称校验失败"
          }
        });
      }
      await addOperationLog({
        title: "编辑用户资料",
        target: currentUser.account || currentUser.id,
        type: "用户",
        note: formatFailureContext(e, tempData.nickname || currentUser.nickname || ""),
        success: false
      });
      if (!(e && (e.code === "NICKNAME_EXISTS" || e.code === "INVALID_NICKNAME"))) {
        this.handlePageError(e, "保存失败，请重试");
      }
      console.error("doSaveEdit error:", e);
    }
  },

  toggleConsignPermission() {
    const user = this.data.currentUser;
    if (!user) return;
    const newState = !user.canConsign;
    this.showDialog({
      type: newState ? "enableConsign" : "disableConsign",
      title: newState ? "开启寄售权限？" : "关闭寄售权限？",
      content: newState ? "确认开启该用户的寄售权限吗？" : "关闭后，该用户已上架商品将全部自动下架，确认关闭吗？",
      confirmText: newState ? "确认开启" : "确认关闭"
    });
  },

  async doToggleConsignPermission() {
    const user = this.data.currentUser;
    if (!user) return;
    const canConsign = !user.canConsign;
    let productsToUpdate = [];
    try {
      this.clearPageError();
      
      await usersRepository.adminToggleConsignPermission(user.id, canConsign);
      
      // 如果是关闭权限，需要将该用户所有已上架的商品下架
      if (!canConsign) {
        const allProducts = await this.fetchAll(PRODUCTS_COLLECTION);
        const userProducts = allProducts.filter((item) => productBelongsToUser(item, user));
        productsToUpdate = userProducts.filter((p) => {
          const totalQuantity = Number(p.totalQuantity || 0);
          const soldCount = Number(p.soldCount || 0);
          const remainingCount = Math.max(0, totalQuantity - soldCount);
          return p.status === "up" && remainingCount > 0;
        });
        
        await Promise.all(
          productsToUpdate.map((item) =>
            dataAccessService.updateDocById(PRODUCTS_COLLECTION, item._id, {
              status: "down",
              updatedAt: new Date()
            })
          )
        );
      }
      
      await addOperationLog({
        title: canConsign ? "开启寄售权限" : "关闭寄售权限",
        target: user.account || user.id,
        type: "用户",
        note: user.nickname || (!canConsign && productsToUpdate.length ? ` · 同步下架 ${productsToUpdate.length} 个商品` : "")
      });
      this.setData({ showConfirmDialog: false });
      await this.loadUsersFromDb();
      const currentUser = this.data.users.find((u) => u.id === user.id) || null;
      this.setData({ currentUser });
      wx.showToast({ title: canConsign ? "已开启寄售权限" : "已关闭寄售权限", icon: "success" });
    } catch (e) {
      await addOperationLog({
        title: canConsign ? "开启寄售权限" : "关闭寄售权限",
        target: user.account || user.id,
        type: "用户",
        note: formatFailureContext(e, user.nickname || ""),
        success: false
      });
      this.handlePageError(e, "操作失败，请重试");
      console.error("doToggleConsignPermission error:", e);
    }
  },

  resetPassword() {
    this.showDialog({
      type: "resetPassword",
      title: "重置密码",
      content: "确认将该用户密码重置为 123456 吗？",
      confirmText: "确认重置"
    });
  },

  async doResetPassword() {
    const user = this.data.currentUser;
    const currentSession = require("../../../utils/session").getSession();
    if (!user) return;
    try {
      this.clearPageError();
      if (!currentSession || currentSession.role !== "admin") {
        wx.showToast({ title: "管理员登录态已失效，请重新登录", icon: "none" });
        return;
      }
      await authService.adminResetPassword(currentSession.userId, user.id, "123456");
      if (!this.data._pageAlive) return;
      await addOperationLog({
        title: "重置用户密码",
        target: user.account || user.id,
        type: "用户",
        note: user.nickname || ""
      });
      this.setData({ showConfirmDialog: false });
      wx.showToast({ title: "重置密码成功", icon: "success" });
    } catch (e) {
      await addOperationLog({
        title: "重置用户密码",
        target: user.account || user.id,
        type: "用户",
        note: formatFailureContext(e, user.nickname || ""),
        success: false
      });
      this.handlePageError(e, "重置失败，请重试");
      console.error("doResetPassword error:", e);
    }
  },

  showDialog({ type, title, content, confirmText }) {
    this.setData({
      showConfirmDialog: true,
      dialogType: type,
      dialogTitle: title,
      dialogContent: content,
      dialogConfirmText: confirmText
    });
  },

  closeDialog() {
    this.setData({ showConfirmDialog: false });
  },

  async confirmDialog() {
    const { dialogType } = this.data;
    if (dialogType === "disableConsign" || dialogType === "enableConsign") return this.doToggleConsignPermission();
    if (dialogType === "resetPassword") return this.doResetPassword();
  },

  toggleRoleDropdown() {
    this.setData({
      showRoleDropdown: !this.data.showRoleDropdown,
      showInactiveDropdown: false
    });
  },

  selectRoleFilter(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ selectedRoleIndex: index, showRoleDropdown: false });
    this.applyRoleFilter();
  },

  toggleInactiveDropdown() {
    this.setData({
      showInactiveDropdown: !this.data.showInactiveDropdown,
      showRoleDropdown: false
    });
  },

  selectInactiveFilter(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      selectedInactiveIndex: index,
      showInactiveDropdown: false
    });
    this.applyRoleFilter();
  },

  toggleMultiSelect() {
    if (this.data.multiSelect) {
      this.setData({
        multiSelect: false,
        selectedUserIds: [],
        allSelectableChecked: false
      });
      this.applyRoleFilter();
      return;
    }
    this.setData({
      multiSelect: true,
      showRoleDropdown: false,
      showInactiveDropdown: false
    });
    this.applyRoleFilter();
  },

  toggleUserSelectionById(userId) {
    const target = this.data.filteredUsers.find((item) => item.id === userId);
    if (!target || !target.selectable) {
      wx.showToast({
        title: "当前用户不可删除",
        icon: "none"
      });
      return;
    }

    const selectedSet = new Set(this.data.selectedUserIds);
    if (selectedSet.has(userId)) {
      selectedSet.delete(userId);
    } else {
      selectedSet.add(userId);
    }

    this.setData({
      selectedUserIds: Array.from(selectedSet)
    });
    this.applyRoleFilter();
  },

  toggleSelectAllUsers() {
    const selectableIds = this.data.filteredUsers.filter((item) => item.selectable).map((item) => item.id);
    if (!selectableIds.length) {
      wx.showToast({
        title: "当前列表没有可选用户",
        icon: "none"
      });
      return;
    }

    if (this.data.allSelectableChecked) {
      const remaining = this.data.selectedUserIds.filter((id) => !selectableIds.includes(id));
      this.setData({
        selectedUserIds: remaining
      });
    } else {
      const merged = Array.from(new Set(this.data.selectedUserIds.concat(selectableIds)));
      this.setData({
        selectedUserIds: merged
      });
    }

    this.applyRoleFilter();
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value || "" });
  },

  handleSearch() {
    this.setData({
      showRoleDropdown: false,
      showInactiveDropdown: false
    });
    if (this.data.currentView === "userGoods" || this.data.currentView === "userGoodsFilters") {
      this.applyUserGoodsFilter();
      return;
    }
    this.applyRoleFilter();
  },

  clearKeyword() {
    this.setData({
      keyword: "",
      showRoleDropdown: false,
      showInactiveDropdown: false
    });
    if (this.data.currentView === "userGoods" || this.data.currentView === "userGoodsFilters") {
      this.applyUserGoodsFilter();
      return;
    }
    this.applyRoleFilter();
  },

  async handleBatchDeleteUsers() {
    if (!this.data.selectedUserIds.length) {
      wx.showToast({
        title: "请先选择用户",
        icon: "none"
      });
      return;
    }

    const selectedUsers = this.data.users.filter((item) => this.data.selectedUserIds.includes(item.id));

    wx.showModal({
      title: "确认删除",
      content: `确认删除所选 ${selectedUsers.length} 个用户吗？删除后不可恢复，历史结算数据将保留用于统计。`,
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }

        try {
          const allProducts = await this.fetchAll(PRODUCTS_COLLECTION);
          const relatedProducts = allProducts.filter((item) => this.data.selectedUserIds.includes(item.ownerUserId));

          await Promise.all(relatedProducts.map((item) => dataAccessService.removeDocById(PRODUCTS_COLLECTION, item._id)));
          await usersRepository.adminDeleteUsers(this.data.selectedUserIds);
          await addOperationLog({
            title: "批量删除用户",
            target: `${this.data.selectedUserIds.length} 个用户`,
            type: "用户",
            note: `${selectedUsers.map((item) => item.account || item.nickname).slice(0, 5).join("、")}${relatedProducts.length ? ` · 同步删除 ${relatedProducts.length} 个关联商品` : ""}`
          });
          wx.showToast({
            title: "删除成功",
            icon: "success"
          });
          this.setData({
            multiSelect: false,
            selectedUserIds: [],
            allSelectableChecked: false
          });
          await this.loadUsersFromDb();
        } catch (error) {
          await addOperationLog({
            title: "批量删除用户",
            target: `${this.data.selectedUserIds.length} 个用户`,
            type: "用户",
            note: formatFailureContext(error, selectedUsers.map((item) => item.account || item.nickname).slice(0, 5).join("、")),
            success: false
          });
          this.handlePageError(error, "删除失败，请重试");
        }
      }
    });
  },

  async loadSoldItemsForCurrentUser() {
    const user = this.data.currentUser;
    if (!user) return;
    try {
      this.clearPageError();
      await this.reconcileSettlementRecordsForCurrentUser();
      const products = await this.fetchAll(PRODUCTS_COLLECTION);
      const soldItems = products
        .filter((p) => productBelongsToUser(p, user) && Number(p.soldCount || 0) > Number(p.settledCount || 0))
        .flatMap((p) => buildPendingSettlementItems(p, getUserRateFraction(user)));
      this.setData({ soldItems });
      this.recalcSoldSummary();
    } catch (e) {
      this.handlePageError(e, "待结算商品加载失败");
      this.setData({ soldItems: [], selectedSoldCount: 0, soldTotalPayable: "0.00" });
    }
  },

  async deleteSoldItem(event) {
    const rowKey = event.currentTarget.dataset.id;
    const item = this.data.soldItems.find((i) => i.rowKey === rowKey);
    if (!item) {
      wx.showToast({ title: "未找到商品", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认删除",
      content: `确认删除「${item.title}」的已出售记录吗？删除后不可恢复。`,
      success: async ({ confirm }) => {
        if (!confirm) return;

        try {
          this.clearPageError();
          const p = await dataAccessService.getDocById(PRODUCTS_COLLECTION, item.id);
          if (!p) {
            wx.showToast({ title: "商品不存在", icon: "none" });
            return;
          }

          const totalQuantity = Number(p.totalQuantity || 0);
          const soldCount = Number(p.soldCount || 0);
          const settledCount = Number(p.settledCount || 0);
          const deleteQty = Number(item.soldQty || 0);

          const nextSoldCount = Math.max(0, soldCount - deleteQty);
          const remainingCount = Math.max(0, totalQuantity - nextSoldCount);

          let nextStatus = p.status;
          if (nextSoldCount <= 0) {
            nextStatus = "up";
          } else if (remainingCount <= 0 && totalQuantity > 0) {
            nextStatus = "sold";
          }

          let nextBatches = normalizeSoldBatches(p);
          if (typeof item.batchIndex === "number" && item.batchIndex >= 0 && item.batchIndex < nextBatches.length) {
            nextBatches = nextBatches.filter((_, idx) => idx !== item.batchIndex);
          } else {
            if (nextBatches.length > 0) {
              nextBatches.pop();
            }
          }

          await dataAccessService.updateDocById(PRODUCTS_COLLECTION, item.id, {
            soldCount: nextSoldCount,
            soldBatches: nextBatches.length > 0 ? nextBatches : undefined,
            status: nextStatus,
            updatedAt: new Date()
          });

          await addOperationLog({
            title: "删除已出售记录",
            target: item.title,
            type: "商品",
            note: `用户 ${this.data.currentUser.nickname} · 删除 ${deleteQty} 件`
          });

          wx.showToast({ title: "删除成功", icon: "success" });
          await this.loadSoldItemsForCurrentUser();
          await this.refreshUserStats();
        } catch (e) {
          await addOperationLog({
            title: "删除已出售记录",
            target: item.title,
            type: "商品",
            note: formatFailureContext(e, ""),
            success: false
          });
          this.handlePageError(e, "删除失败，请重试");
          console.error("deleteSoldItem error:", e);
        }
      }
    });
  },

  toggleSoldItem(event) {
    const rowKey = event.currentTarget.dataset.id;
    const soldItems = this.data.soldItems.map((item) => (item.rowKey === rowKey ? { ...item, selected: !item.selected } : item));
    this.setData({ soldItems });
    this.recalcSoldSummary();
  },

  toggleSoldAll() {
    const { soldItems } = this.data;
    const allSelected = soldItems.length > 0 && soldItems.every((item) => item.selected);
    this.setData({ soldItems: soldItems.map((item) => ({ ...item, selected: !allSelected })) });
    this.recalcSoldSummary();
  },

  handleSettleSubmit() {
    if (this.data.submitting) {
      return;
    }
    const selectedItems = this.data.soldItems.filter((item) => item.selected);
    if (!selectedItems.length) {
      wx.showToast({ title: "请先选择商品", icon: "none" });
      return;
    }
    const settlementGross = selectedItems.reduce((sum, item) => sum + item.price * item.soldQty, 0);
    const settlementCommission = selectedItems.reduce((sum, item) => sum + item.price * item.soldQty * item.rateFraction, 0);
    const settlementActualIncome = selectedItems.reduce((sum, item) => sum + Number(item.saleAmount != null ? item.saleAmount : item.price * item.soldQty), 0);
    this.setData({
      settlementItems: selectedItems.map((item) => ({
        ...item,
        rateFraction: normalizeRateFraction(item.rateFraction),
        rate: Number(item.rate || 0),
        totalPrice: item.price * item.soldQty,
        saleAmount: Number(item.saleAmount != null ? item.saleAmount : item.price * item.soldQty),
        saleAmountText: fmt2(item.saleAmount != null ? item.saleAmount : item.price * item.soldQty),
        payableAmount: calcPayableAmount(item.price, item.soldQty, item.rateFraction),
        payableText: fmt2(calcPayableAmount(item.price, item.soldQty, item.rateFraction))
      })),
      settlementGross: fmt2(settlementGross),
      settlementCommission: fmt2(settlementCommission),
      settlementPayable: fmt2(settlementGross - settlementCommission),
      settlementActualIncome: fmt2(settlementActualIncome),
      settlementVouchers: [],
      currentView: "settlement",
      ...this.getViewCopy("settlement")
    });
  },

  onSettlementIncomeInput(event) {
    this.setData({ settlementActualIncome: event.detail.value || "" });
  },

  setDataAsync(nextData) {
    return new Promise((resolve) => {
      this.setData(nextData, resolve);
    });
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

  splitSettlementPosterPages(items = []) {
    const source = Array.isArray(items) ? items : [];
    if (!source.length) {
      return [];
    }
    const pages = [];
    const firstPageItems = source.slice(0, POSTER_FIRST_PAGE_LIMIT);
    const remainItems = source.slice(POSTER_FIRST_PAGE_LIMIT);

    pages.push({
      items: firstPageItems,
      showSummary: remainItems.length === 0,
      showFooter: remainItems.length === 0
    });

    for (let index = 0; index < remainItems.length; index += POSTER_NEXT_PAGE_LIMIT) {
      const chunk = remainItems.slice(index, index + POSTER_NEXT_PAGE_LIMIT);
      pages.push({
        items: chunk,
        showSummary: index + POSTER_NEXT_PAGE_LIMIT >= remainItems.length,
        showFooter: index + POSTER_NEXT_PAGE_LIMIT >= remainItems.length
      });
    }

    return pages.map((page, index) => ({
      ...page,
      pageNo: index + 1,
      totalPages: pages.length
    }));
  },

  buildSettlementPosterMeta() {
    const user = this.data.currentUser || {};
    const now = Date.now();
    const settlementItems = Array.isArray(this.data.settlementItems) ? this.data.settlementItems : [];
    const rateSet = Array.from(new Set(
      settlementItems
        .map((item) => Number(item.rate))
        .filter((rate) => Number.isFinite(rate))
        .map((rate) => rate.toFixed(rate % 1 === 0 ? 0 : 2))
    ));
    const commissionLabel = rateSet.length === 1 ? `平台抽成（${rateSet[0]}%）` : "平台抽成";
    return {
      platformName: "谷圈星社",
      englishTitle: "CONSIGNMENT SETTLEMENT",
      chineseTitle: "寄售结算单",
      orderNo: buildDraftSettlementNo(user, now),
      userName: user.nickname || user.name || "寄售用户",
      userIdText: `UID ${user.id || user._id || user.account || "-"}`,
      dateText: formatDateLabel(now),
      timeText: formatDateTimeLabel(now),
      grossText: fmt2(this.data.settlementGross),
      commissionText: fmt2(this.data.settlementCommission),
      payableText: fmt2(this.data.settlementPayable),
      commissionLabel
    };
  },

  getPosterCanvasHeight(pageInfo) {
    const itemCount = (pageInfo.items || []).length;
    const headerHeight = pageInfo.pageNo === 1 ? 370 : 248;
    const rowHeight = 112;
    const summaryHeight = pageInfo.showSummary ? 208 : 0;
    const footerHeight = pageInfo.showFooter ? 92 : 38;
    return Math.max(860, headerHeight + itemCount * rowHeight + summaryHeight + footerHeight);
  },

  drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  },

  fillRoundedRect(ctx, x, y, width, height, radius, color) {
    ctx.save();
    this.drawRoundedRectPath(ctx, x, y, width, height, radius);
    ctx.setFillStyle(color);
    ctx.fill();
    ctx.restore();
  },

  strokeRoundedRect(ctx, x, y, width, height, radius, color, lineWidth = 1) {
    ctx.save();
    this.drawRoundedRectPath(ctx, x, y, width, height, radius);
    ctx.setStrokeStyle(color);
    ctx.setLineWidth(lineWidth);
    ctx.stroke();
    ctx.restore();
  },

  truncateCanvasText(ctx, text, maxWidth) {
    const content = String(text || "");
    if (!content) {
      return "";
    }
    if (ctx.measureText(content).width <= maxWidth) {
      return content;
    }
    let output = content;
    while (output.length > 0 && ctx.measureText(`${output}...`).width > maxWidth) {
      output = output.slice(0, -1);
    }
    return `${output}...`;
  },

  drawCanvasTextPair(ctx, label, value, leftX, rightX, y, options = {}) {
    const {
      labelColor = "#8d806d",
      valueColor = "#373737",
      labelSize = 14,
      valueSize = 15,
      valueMaxWidth = 240
    } = options;
    ctx.setTextAlign("left");
    ctx.setFillStyle(labelColor);
    ctx.setFontSize(labelSize);
    ctx.fillText(label, leftX, y);
    ctx.setTextAlign("right");
    ctx.setFillStyle(valueColor);
    ctx.setFontSize(valueSize);
    ctx.fillText(this.truncateCanvasText(ctx, value, valueMaxWidth), rightX, y);
  },

  drawSettlementPosterCover(ctx, item, imagePath, x, y, size) {
    if (imagePath) {
      try {
        ctx.save();
        this.drawRoundedRectPath(ctx, x, y, size, size, 14);
        ctx.clip();
        ctx.drawImage(imagePath, x, y, size, size);
        ctx.restore();
        return;
      } catch (error) {
        try {
          ctx.restore();
        } catch (e) {}
      }
    }

    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, "#d7b4ff");
    gradient.addColorStop(1, "#87c8ff");
    this.fillRoundedRect(ctx, x, y, size, size, 14, gradient);
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(22);
    ctx.setTextAlign("center");
    ctx.setTextBaseline("middle");
    const fallback = String((item.title || item.series || "谷").trim()).slice(0, 2);
    ctx.fillText(fallback || "谷", x + size / 2, y + size / 2);
    ctx.setTextAlign("left");
    ctx.setTextBaseline("alphabetic");
  },

  async renderSettlementPosterPage(pageInfo, meta, localImageMap) {
    const canvasHeight = this.getPosterCanvasHeight(pageInfo);
    await this.setDataAsync({
      posterCanvasWidth: POSTER_CANVAS_WIDTH,
      posterCanvasHeight: canvasHeight
    });

    const ctx = wx.createCanvasContext("settlementPosterCanvas", this);
    ctx.setFillStyle("#f7f3eb");
    ctx.fillRect(0, 0, POSTER_CANVAS_WIDTH, canvasHeight);
    const bg = ctx.createLinearGradient(0, 0, POSTER_CANVAS_WIDTH, canvasHeight);
    bg.addColorStop(0, "rgba(255,255,255,0.28)");
    bg.addColorStop(1, "rgba(244,236,224,0.08)");
    ctx.setFillStyle(bg);
    ctx.fillRect(0, 0, POSTER_CANVAS_WIDTH, canvasHeight);

    const cardX = (POSTER_CANVAS_WIDTH - POSTER_CARD_WIDTH) / 2;
    const cardY = 22;
    const cardHeight = canvasHeight - 44;
    this.fillRoundedRect(ctx, cardX, cardY, POSTER_CARD_WIDTH, cardHeight, 8, "#fffdfa");
    this.strokeRoundedRect(ctx, cardX, cardY, POSTER_CARD_WIDTH, cardHeight, 8, "rgba(216, 204, 184, 0.9)", 1);

    let cursorY = cardY + POSTER_PADDING;
    const leftX = cardX + 30;
    const rightX = cardX + POSTER_CARD_WIDTH - 30;

    ctx.setFillStyle("#313131");
    ctx.setTextAlign("center");
    ctx.setFontSize(28);
    ctx.fillText(meta.platformName, cardX + POSTER_CARD_WIDTH / 2, cursorY);
    cursorY += 34;

    ctx.setFillStyle("#b3a793");
    ctx.setFontSize(11);
    ctx.fillText(meta.englishTitle, cardX + POSTER_CARD_WIDTH / 2, cursorY);
    cursorY += 34;

    ctx.setFillStyle("#434343");
    ctx.setFontSize(18);
    ctx.fillText(pageInfo.pageNo === 1 ? meta.chineseTitle : "寄售结算单 · 续页", cardX + POSTER_CARD_WIDTH / 2, cursorY);
    cursorY += 24;

    if (pageInfo.totalPages > 1) {
      ctx.setFillStyle("#b7ab96");
      ctx.setFontSize(11);
      ctx.fillText(`第 ${pageInfo.pageNo} 张 / 共 ${pageInfo.totalPages} 张`, cardX + POSTER_CARD_WIDTH / 2, cursorY);
      cursorY += 22;
    } else {
      cursorY += 4;
    }

    ctx.setStrokeStyle("#d9cebf");
    ctx.setLineWidth(1);
    ctx.setLineDash([4, 4], 0);
    ctx.beginPath();
    ctx.moveTo(leftX, cursorY);
    ctx.lineTo(rightX, cursorY);
    ctx.stroke();
    ctx.setLineDash([], 0);
    cursorY += 28;

    if (pageInfo.pageNo === 1) {
      const infoRows = [
        ["结算单号", meta.orderNo],
        ["寄售用户", meta.userName],
        ["结算日期", meta.dateText]
      ];
      infoRows.forEach(([label, value]) => {
        this.drawCanvasTextPair(ctx, label, value, leftX, rightX, cursorY, {
          labelColor: "#897c68",
          valueColor: "#343434",
          labelSize: 14,
          valueSize: 15,
          valueMaxWidth: 260
        });
        cursorY += 34;
      });

      ctx.setStrokeStyle("#d9cebf");
      ctx.setLineDash([4, 4], 0);
      ctx.beginPath();
      ctx.moveTo(leftX, cursorY - 10);
      ctx.lineTo(rightX, cursorY - 10);
      ctx.stroke();
      ctx.setLineDash([], 0);
      cursorY += 24;
    } else {
      this.drawCanvasTextPair(ctx, "结算单号", meta.orderNo, leftX, rightX, cursorY, {
        labelColor: "#8d806d",
        valueColor: "#343434",
        labelSize: 13,
        valueSize: 14,
        valueMaxWidth: 250
      });
      cursorY += 24;
      this.drawCanvasTextPair(ctx, "寄售用户", meta.userName, leftX, rightX, cursorY, {
        labelColor: "#8d806d",
        valueColor: "#343434",
        labelSize: 13,
        valueSize: 14,
        valueMaxWidth: 250
      });
      cursorY += 30;
    }

    ctx.setFillStyle("#b3a793");
    ctx.setTextAlign("left");
    ctx.setFontSize(13);
    ctx.fillText("商品 · 名称 / 类型", leftX, cursorY);
    ctx.setTextAlign("right");
    ctx.fillText("抽成后金额", rightX, cursorY);
    cursorY += 20;

    const thumbSize = 64;
    (pageInfo.items || []).forEach((item, index) => {
      if (index > 0) {
        ctx.setStrokeStyle("#efe4d3");
        ctx.setLineWidth(1);
        ctx.setLineDash([2, 2], 0);
        ctx.beginPath();
        ctx.moveTo(leftX, cursorY);
        ctx.lineTo(rightX, cursorY);
        ctx.stroke();
        ctx.setLineDash([], 0);
        cursorY += 18;
      }

      const imagePath = localImageMap[item.rowKey] || "";
      this.drawSettlementPosterCover(ctx, item, imagePath, leftX, cursorY, thumbSize);

      const titleX = leftX + thumbSize + 16;
      const titleWidth = 220;
      ctx.setFillStyle("#3a3a3a");
      ctx.setTextAlign("left");
      ctx.setFontSize(16);
      ctx.fillText(this.truncateCanvasText(ctx, item.title || "-", titleWidth), titleX, cursorY + 18);

      ctx.setFillStyle("#938670");
      ctx.setFontSize(13);
      ctx.fillText(this.truncateCanvasText(ctx, item.type || "-", titleWidth), titleX, cursorY + 42);

      ctx.setFillStyle("#a89881");
      ctx.setFontSize(12);
      ctx.fillText(`标价 ¥${fmt2(item.price)} · 数量 ${item.soldQty || 1}`, titleX + 104, cursorY + 42);

      ctx.setFillStyle("#343434");
      ctx.setTextAlign("right");
      ctx.setFontSize(17);
      ctx.fillText(`¥${fmt2(item.payableAmount != null ? item.payableAmount : item.totalPrice)}`, rightX, cursorY + 18);

      cursorY += 82;
    });

    if (pageInfo.showSummary) {
      cursorY += 20;
      ctx.setStrokeStyle("#d9cebf");
      ctx.setLineDash([4, 4], 0);
      ctx.beginPath();
      ctx.moveTo(leftX, cursorY);
      ctx.lineTo(rightX, cursorY);
      ctx.stroke();
      ctx.setLineDash([], 0);
      cursorY += 34;

      const summaryRows = [
        ["商品总额（寄售价）", `¥${meta.grossText}`],
        [meta.commissionLabel || "平台抽成", `-¥${meta.commissionText}`]
      ];
      summaryRows.forEach(([label, value]) => {
        this.drawCanvasTextPair(ctx, label, value, leftX, rightX, cursorY, {
          labelColor: "#6f6558",
          valueColor: "#5a5248",
          labelSize: 15,
          valueSize: 15,
          valueMaxWidth: 180
        });
        cursorY += 34;
      });

      ctx.setStrokeStyle("#d9cebf");
      ctx.setLineDash([4, 4], 0);
      ctx.beginPath();
      ctx.moveTo(leftX, cursorY - 8);
      ctx.lineTo(rightX, cursorY - 8);
      ctx.stroke();
      ctx.setLineDash([], 0);
      cursorY += 34;

      ctx.setFillStyle("#2f2f2f");
      ctx.setFontSize(18);
      ctx.setTextAlign("left");
      ctx.fillText("应付寄售用户", leftX, cursorY);

      ctx.setFillStyle("#ef617b");
      ctx.setTextAlign("right");
      ctx.setFontSize(29);
      ctx.fillText(`¥${meta.payableText}`, rightX, cursorY);
      cursorY += 36;
    }

    if (pageInfo.showFooter) {
      cursorY += 18;
    } else {
      cursorY += 8;
    }

    ctx.setFillStyle("#bcaf99");
    ctx.setFontSize(11);
    ctx.setTextAlign("center");
    ctx.fillText(`${meta.timeText}  ·  ${meta.orderNo}  ·  谷圈星社`, cardX + POSTER_CARD_WIDTH / 2, cursorY);

    await new Promise((resolve) => ctx.draw(false, resolve));

    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath(
        {
          canvasId: "settlementPosterCanvas",
          width: POSTER_CANVAS_WIDTH,
          height: canvasHeight,
          destWidth: POSTER_CANVAS_WIDTH * 2,
          destHeight: canvasHeight * 2,
          fileType: "png",
          quality: 1,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        },
        this
      );
    }).catch(() => {
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath(
          {
            canvasId: "settlementPosterCanvas",
            width: POSTER_CANVAS_WIDTH,
            height: canvasHeight,
            fileType: "png",
            quality: 1,
            success: (res) => resolve(res.tempFilePath),
            fail: reject
          },
          this
        );
      });
    });
  },

  async generateSettlementPoster() {
    const items = this.data.settlementItems || [];
    if (!items.length) {
      wx.showToast({ title: "请先选择待结算商品", icon: "none" });
      return;
    }
    if (this.data.generatingSettlementPoster) {
      return;
    }

    this.clearPageError();
    await this.setDataAsync({ generatingSettlementPoster: true });
    wx.showLoading({ title: "生成中...", mask: true });

    try {
      const pages = this.splitSettlementPosterPages(items);
      const meta = this.buildSettlementPosterMeta();
      const localImageMap = {};

      await Promise.all(
        items.map(async (item) => {
          if (!item.coverImage) {
            return;
          }
          try {
            localImageMap[item.rowKey] = await this.resolvePosterImagePath(item.coverImage);
          } catch (error) {
            localImageMap[item.rowKey] = "";
          }
        })
      );

      const posterImages = [];
      for (const pageInfo of pages) {
        const filePath = await this.renderSettlementPosterPage(pageInfo, meta, localImageMap);
        posterImages.push(filePath);
      }

      await this.setDataAsync({
        showSettlementPosterPreview: true,
        settlementPosterImages: posterImages,
        settlementPosterCurrent: 0,
        settlementPosterOrderNo: meta.orderNo,
        settlementPosterDateText: meta.dateText
      });
    } catch (error) {
      console.error("generateSettlementPoster error:", error);
      this.handlePageError(error, "图片生成失败，请重试");
      wx.showToast({ title: "图片生成失败，请重试", icon: "none" });
    } finally {
      wx.hideLoading();
      await this.setDataAsync({ generatingSettlementPoster: false });
    }
  },

  closeSettlementPosterPreview() {
    this.setData({ showSettlementPosterPreview: false });
  },

  onSettlementPosterChange(event) {
    this.setData({ settlementPosterCurrent: Number(event.detail.current || 0) });
  },

  previewCurrentSettlementPoster() {
    const images = this.data.settlementPosterImages || [];
    if (!images.length) {
      return;
    }
    const current = images[this.data.settlementPosterCurrent] || images[0];
    wx.previewImage({
      current,
      urls: images
    });
  },

  ensureAlbumPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (settingRes) => {
          const scopeKey = "scope.writePhotosAlbum";
          const authState = settingRes.authSetting ? settingRes.authSetting[scopeKey] : undefined;

          if (authState === true || authState === undefined) {
            resolve();
            return;
          }

          wx.showModal({
            title: "需要相册权限",
            content: "保存图片到本地需要开启相册权限。",
            success: ({ confirm }) => {
              if (!confirm) {
                reject(new Error("已取消保存"));
                return;
              }

              wx.openSetting({
                success: (openRes) => {
                  if (openRes.authSetting && openRes.authSetting[scopeKey]) {
                    resolve();
                  } else {
                    reject(new Error("未开启相册权限"));
                  }
                },
                fail: () => reject(new Error("无法打开权限设置"))
              });
            },
            fail: () => reject(new Error("权限校验失败"))
          });
        },
        fail: () => reject(new Error("权限校验失败"))
      });
    });
  },

  saveImageToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: resolve,
        fail: (error) => {
          const errMsg = String((error && error.errMsg) || "");
          if (/auth deny|auth denied|permission|photosalbum/i.test(errMsg)) {
            reject(new Error("未开启相册权限"));
            return;
          }
          reject(new Error("保存图片失败"));
        }
      });
    });
  },

  async saveSettlementPosterImages() {
    const images = this.data.settlementPosterImages || [];
    if (!images.length) {
      return;
    }

    wx.showLoading({ title: "保存中...", mask: true });
    let savedCount = 0;
    try {
      await this.ensureAlbumPermission();
      for (const filePath of images) {
        await this.saveImageToAlbum(filePath);
        savedCount += 1;
      }
      wx.showToast({
        title: savedCount > 1 ? `已保存 ${savedCount} 张结算图片` : "已保存到相册",
        icon: "success"
      });
    } catch (error) {
      const errMsg = String((error && (error.errMsg || error.message)) || "");
      if (/相册权限|未开启相册权限|权限|auth deny|auth denied/i.test(errMsg)) {
        wx.showModal({
          title: "需要相册权限",
          content: "请开启相册写入权限后重试",
          confirmText: "去开启",
          success: ({ confirm }) => {
            if (confirm) {
              wx.openSetting();
            }
          }
        });
      } else if (savedCount > 0) {
        wx.showToast({ title: "部分图片保存失败，请重试", icon: "none" });
      } else {
        wx.showToast({ title: "保存失败，请重试", icon: "none" });
      }
    } finally {
      wx.hideLoading();
    }
  },

  chooseSettlementVoucher() {
    const remaining = 3 - this.data.settlementVouchers.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多上传 3 张凭证", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const valid = [];
        let rejected = 0;
        (res.tempFiles || []).forEach((file) => {
          if (file.size && file.size > 5 * 1024 * 1024) {
            rejected += 1;
            return;
          }
          valid.push(file.tempFilePath);
        });

        if (rejected) {
          wx.showToast({
            title: `已过滤 ${rejected} 张超过 5M 的图片`,
            icon: "none"
          });
        }

        const vouchers = this.data.settlementVouchers.concat(valid).slice(0, 3);
        this.setData({ settlementVouchers: vouchers });
      }
    });
  },

  async previewSettlementVoucher(event) {
    const { index } = event.currentTarget.dataset;
    const vouchers = this.data.settlementVouchers;
    if (!vouchers || !vouchers.length) return;

    wx.showLoading({ title: "加载中..." });
    try {
      // 转换云存储 fileID 为临时访问链接
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

      // 构建最终的预览 URL 数组
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

  deleteSettlementVoucher(event) {
    const { index } = event.currentTarget.dataset;
    const vouchers = this.data.settlementVouchers.filter((_, i) => i !== index);
    this.setData({ settlementVouchers: vouchers });
  },

  async submitSettlement() {
    const user = this.data.currentUser;
    const items = this.data.settlementItems || [];
    if (!user || !items.length) return;
    if (this.data.submitting) {
      return;
    }
    try {
      this.setData({ submitting: true });
      this.clearPageError();
      
      // 上传凭证图片
      let voucherCloudPaths = [];
      if (this.data.settlementVouchers.length > 0) {
        wx.showLoading({ title: "上传凭证中..." });
        voucherCloudPaths = await ensureCloudImages(
          this.data.settlementVouchers,
          "settlement-vouchers"
        );
        wx.hideLoading();
      }

      const now = new Date();
      const record = {
        userId: user.id,
        userNickname: user.nickname,
        userAccount: user.account,
        date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
        month: `${now.getFullYear()} · ${String(now.getMonth() + 1).padStart(2, "0")}`,
        items: items.reduce((s, i) => s + Number(i.soldQty || 0), 0),
        gross: Number(this.data.settlementGross),
        commission: Number(this.data.settlementCommission),
        payable: Number(this.data.settlementPayable),
        actualIncome: Number(this.data.settlementActualIncome || this.data.settlementGross),
        settlementItems: items.map((item) => ({
          ...item,
          saleAmount: Number(item.saleAmount != null ? item.saleAmount : item.price * item.soldQty),
          rateFraction: normalizeRateFraction(item.rateFraction),
          rate: Number(item.rate || 0)
        })),
        vouchers: voucherCloudPaths,
        createdAt: now,
        updatedAt: now
      };
      await dataAccessService.addDoc(SETTLEMENT_RECORDS_COLLECTION, record);
      await Promise.all(
        items.map(async (item) => {
          const updated = await productsRepository.applySettlementToProduct(
            item.productId || item.id,
            Number(item.soldQty || 0),
            normalizeRateFraction(item.rateFraction)
          );
          if (!updated) {
            throw new Error(`商品结算状态更新失败: ${item.title || item.productId || item.id}`);
          }
        })
      );
      await addOperationLog({
        title: "提交结算",
        target: user.account || user.id,
        type: "结算",
        note: `${record.items} 件商品，应结算 ¥${record.payable.toFixed(2)}`
      });
      await this.refreshUserStats();
      await this.loadSoldItemsForCurrentUser();
      await this.loadSettledRecordsForCurrentUser();
      this.setData({
        settlementItems: [],
        settlementGross: "0.00",
        settlementCommission: "0.00",
        settlementPayable: "0.00",
        settlementActualIncome: "",
        currentView: "settledList",
        ...this.getViewCopy("settledList")
      });
      wx.showToast({ title: "提交成功", icon: "success" });
    } catch (e) {
      await addOperationLog({
        title: "提交结算",
        target: user ? (user.account || user.id) : "未知用户",
        type: "结算",
        note: formatFailureContext(e, `${items.length} 条结算项`),
        success: false
      });
      this.handlePageError(e, "提交失败，请重试");
      console.error("submitSettlement error:", e);
    } finally {
      if (this.data._pageAlive) {
        this.setData({ submitting: false });
      }
    }
  },

  async loadSettledRecordsForCurrentUser() {
    const user = this.data.currentUser;
    if (!user) return;
    try {
      this.clearPageError();
      const settledRecords = await this.fetchAll(SETTLEMENT_RECORDS_COLLECTION, { userId: user.id });
      this.applySettledRecordsToView(settledRecords);

      this.reconcileSettlementRecordsForCurrentUser()
        .then(async (result) => {
          if (!this.data._pageAlive || this.data.currentView !== "settledList") {
            return;
          }
          if (result && (result.removedDuplicateCount > 0 || result.repairedCount > 0)) {
            const latestRecords = await this.fetchAll(SETTLEMENT_RECORDS_COLLECTION, { userId: user.id });
            if (!this.data._pageAlive || this.data.currentView !== "settledList") {
              return;
            }
            this.applySettledRecordsToView(latestRecords);
          }
        })
        .catch((error) => {
          console.warn("reconcileSettlementRecordsForCurrentUser:", error);
        });
    } catch (e) {
      this.setData({ settledRecords: [] });
      this.recalcSettledSummary();
      this.handlePageError(e, "已结算记录加载失败");
      console.warn("loadSettledRecordsForCurrentUser:", e);
    }
  },

  applySettledRecordsToView(settledRecords) {
    const uniqueRecordsMap = new Map();
    (Array.isArray(settledRecords) ? settledRecords : []).forEach((record) => {
      if (record && record._id) {
        uniqueRecordsMap.set(record._id, record);
      }
    });
    const uniqueSettledRecords = Array.from(uniqueRecordsMap.values());
    uniqueSettledRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
    this.setData({ settledRecords: uniqueSettledRecords });
    this.recalcSettledSummary();
  },

  async reconcileSettlementRecordsForCurrentUser() {
    const user = this.data.currentUser;
    if (!user || !user.id) return;

    const userId = String(user.id);
    this._settlementReconcileDone = this._settlementReconcileDone || {};
    this._settlementReconcilePending = this._settlementReconcilePending || {};

    if (this._settlementReconcileDone[userId]) {
      return { removedDuplicateCount: 0, repairedCount: 0 };
    }
    if (this._settlementReconcilePending[userId]) {
      return this._settlementReconcilePending[userId];
    }

    this._settlementReconcilePending[userId] = (async () => {
      const settledRecords = await this.fetchAll(SETTLEMENT_RECORDS_COLLECTION, { userId });
      const { records: dedupedRecords, removedCount: removedDuplicateCount } = await this.removeDuplicateSettlementRecordsForUser(user, settledRecords);
      let repairedCount = 0;

      for (const record of dedupedRecords) {
        const settlementItems = Array.isArray(record && record.settlementItems) ? record.settlementItems : [];
        for (const item of settlementItems) {
          const batchIndex = Number(item && item.batchIndex);
          const quantity = Number(item && item.soldQty || 0);
          const productId = String((item && (item.productId || item.id)) || "").trim();

          if (!productId || !Number.isInteger(batchIndex) || batchIndex < 0 || quantity <= 0) {
            continue;
          }

          const result = await productsRepository.repairSettlementToProduct(
            productId,
            quantity,
            batchIndex,
            normalizeRateFraction(item.rateFraction)
          );

          if (result && result.updated) {
            repairedCount += 1;
          }
        }
      }

      if (repairedCount > 0) {
        await addOperationLog({
          title: "修复历史结算状态",
          target: user.account || user.id,
          type: "结算",
          note: `自动补齐 ${repairedCount} 条历史结算商品状态`
        });
        await this.refreshUserStats();
      }

      this._settlementReconcileDone[userId] = true;
      return {
        removedDuplicateCount,
        repairedCount
      };
    })();

    try {
      await this._settlementReconcilePending[userId];
    } finally {
      delete this._settlementReconcilePending[userId];
    }
  },

  async removeDuplicateSettlementRecordsForUser(user, settledRecords) {
    const records = Array.isArray(settledRecords) ? [...settledRecords] : [];
    if (!user || !user.id || records.length < 2) {
      return {
        records,
        removedCount: 0
      };
    }

    const sortedRecords = records.sort((a, b) => {
      const aTime = new Date(a && (a.createdAt || a.updatedAt || a.date) || 0).getTime() || 0;
      const bTime = new Date(b && (b.createdAt || b.updatedAt || b.date) || 0).getTime() || 0;
      return aTime - bTime;
    });

    const keepMap = new Map();
    const duplicates = [];

    sortedRecords.forEach((record) => {
      const fingerprint = buildSettlementRecordFingerprint(record);
      if (!keepMap.has(fingerprint)) {
        keepMap.set(fingerprint, record);
        return;
      }
      duplicates.push(record);
    });

    const removable = duplicates.filter((record) => record && record._id);
    if (!removable.length) {
      return {
        records: Array.from(keepMap.values()),
        removedCount: 0
      };
    }

    await Promise.all(
      removable.map((record) => dataAccessService.removeDocById(SETTLEMENT_RECORDS_COLLECTION, record._id))
    );

    await addOperationLog({
      title: "清理重复结算记录",
      target: user.account || user.id,
      type: "结算",
      note: `自动删除 ${removable.length} 条重复结算记录`
    });

    return {
      records: Array.from(keepMap.values()),
      removedCount: removable.length
    };
  },

  async retryCurrentView() {
    const view = this.data.currentView;
    if (view === "userList" || view === "emptyUser") {
      await this.loadUsersFromDb();
      return;
    }
    if (view === "userGoods") {
      await this.loadUserGoodsForCurrentUser();
      return;
    }
    if (view === "soldGoods") {
      await this.loadSoldItemsForCurrentUser();
      return;
    }
    if (view === "settledList") {
      await this.loadSettledRecordsForCurrentUser();
      return;
    }
    if (view === "settlement" || view === "settledDetail" || view === "userDetail") {
      await this.loadUsersFromDb();
    }
  },

  async openSettledDetail(event) {
    const recordId = event.currentTarget.dataset.id;
    const settledDetail = this.data.settledRecords.find((item) => item._id === recordId || item.id === recordId) || null;
    const settlementItems = ((settledDetail && settledDetail.settlementItems) || []).map((item, index) => ({
      ...item,
      rowKey: item.rowKey || `${item.id || "item"}-${index}`,
      totalPrice: item.totalPrice || (item.price * item.soldQty),
      payableAmount: Number(item.payableAmount != null ? item.payableAmount : calcPayableAmount(item.price, item.soldQty, item.rateFraction)),
      payableText: fmt2(item.payableAmount != null ? item.payableAmount : calcPayableAmount(item.price, item.soldQty, item.rateFraction))
    }));
    const subtitle = settledDetail ? `${settledDetail.date} · 共 ${settledDetail.items} 件商品` : "";
    
    // 先设置基础数据
    this.setData({
      settledDetail,
      settlementItems,
      settlementVouchers: [],
      settledDetailPayable: settledDetail ? fmt2(settledDetail.payable) : "0.00",
      settledDetailGross: settledDetail ? fmt2(settledDetail.gross) : "0.00",
      settledDetailCommission: settledDetail ? fmt2(settledDetail.commission) : "0.00",
      settledDetailActualIncome: settledDetail ? fmt2(settledDetail.actualIncome) : "0.00",
      currentView: "settledDetail",
      viewTitle: "结算详情",
      viewSubtitle: subtitle
    });

    // 转换云存储文件 ID 为临时访问链接
    const vouchers = (settledDetail && settledDetail.vouchers) || [];
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
        // 转换失败时使用原始路径
        this.setData({ settlementVouchers: vouchers });
      }
    }
  },

  recalcSettledSummary() {
    const settledRecords = this.data.settledRecords || [];
    const settledTotalPayable = settledRecords.reduce((sum, item) => sum + Number(item.payable || 0), 0).toFixed(0);
    const settledTotalItems = settledRecords.reduce((sum, item) => sum + Number(item.items || 0), 0);
    this.setData({ settledTotalPayable, settledTotalItems, settledTotalTimes: settledRecords.length });
  },

  preventBubble() {},

  recalcSoldSummary() {
    const selectedItems = this.data.soldItems.filter((item) => item.selected);
    const soldTotalPayable = selectedItems
      .reduce((sum, item) => sum + item.price * item.soldQty * (1 - item.rateFraction), 0)
      .toFixed(2);
    this.setData({ selectedSoldCount: selectedItems.length, soldTotalPayable });
  },

  applyRoleFilter() {
    const { users, selectedRoleIndex, selectedInactiveIndex, keyword } = this.data;
    let filteredUsers = users;
    if (selectedRoleIndex === 1) filteredUsers = users.filter((u) => u.roleType === "consignment");
    if (selectedRoleIndex === 2) filteredUsers = users.filter((u) => u.roleType === "normal");
    if (selectedInactiveIndex > 0) {
      const minDays = Number(String(this.data.inactiveOptions[selectedInactiveIndex] || "").replace(/\D/g, "")) || 0;
      filteredUsers = filteredUsers.filter((u) => Number(u.inactiveDays || 0) >= minDays);
    }
    const q = keyword.trim();
    if (q) filteredUsers = filteredUsers.filter((u) => (u.name || "").includes(q) || (u.account || "").includes(q));
    filteredUsers = filteredUsers.map((u) => ({
      ...u,
      selectable: canDeleteUser(u),
      selected: this.data.selectedUserIds.includes(u.id)
    }));
    const selectableIds = filteredUsers.filter((item) => item.selectable).map((item) => item.id);
    const allSelectableChecked = Boolean(
      selectableIds.length && selectableIds.every((id) => this.data.selectedUserIds.includes(id))
    );
    this.setData({ filteredUsers, allSelectableChecked });
  },

  // 用户商品筛选下拉
  toggleDropdown(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      activeDropdown: this.data.activeDropdown === key ? null : key
    });
  },

  closeDropdown() {
    this.setData({ activeDropdown: null });
  },

  onUserGoodsDropdownSelect(e) {
    const { key, index } = e.currentTarget.dataset;
    if (key === "status") {
      this.setData({
        userGoodsStatusIndex: index,
        activeDropdown: null
      });
      this.applyUserGoodsFilter();
    }
  },

  applyUserGoodsFilter() {
    const { userGoodsItems, userGoodsStatusIndex, keyword } = this.data;
    let filteredUserGoodsItems = userGoodsItems;
    
    if (userGoodsStatusIndex === 1) {
      filteredUserGoodsItems = userGoodsItems.filter((item) => item.statusKey === "up");
    } else if (userGoodsStatusIndex === 2) {
      filteredUserGoodsItems = userGoodsItems.filter((item) => item.statusKey === "down");
    } else if (userGoodsStatusIndex === 3) {
      filteredUserGoodsItems = userGoodsItems.filter((item) => item.statusKey === "sold");
    } else if (userGoodsStatusIndex === 4) {
      filteredUserGoodsItems = userGoodsItems.filter((item) => item.statusKey === "settled");
    }

    const q = String(keyword || "").trim().toLowerCase();
    if (q) {
      filteredUserGoodsItems = filteredUserGoodsItems.filter((item) =>
        [item.title, item.ip, item.type, item.series, item.owner]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(q))
      );
    }
    
    this.setData({ filteredUserGoodsItems });
  },

  getViewCopy(viewId) {
    const copyMap = {
      userList: { viewTitle: "用户管理", viewSubtitle: "" },
      userDetail: { viewTitle: "用户详情", viewSubtitle: "" },
      userDetailSaved: { viewTitle: "用户详情", viewSubtitle: "" },
      userGoods: { viewTitle: "全部寄售商品", viewSubtitle: `${this.data.currentUser ? this.data.currentUser.goodsCount : 0} 件` },
      userGoodsFilters: { viewTitle: "全部寄售商品", viewSubtitle: "商品筛选下拉状态" },
      soldGoods: { viewTitle: "已售出 · 待结算", viewSubtitle: "" },
      settlement: { viewTitle: "结算", viewSubtitle: "确认信息后提交" },
      settledList: { viewTitle: "已结算记录", viewSubtitle: "历史结算" },
      settledDetail: { viewTitle: "结算详情", viewSubtitle: "" },
      confirmDialog: { viewTitle: "确认操作", viewSubtitle: "" },
      emptyUser: { viewTitle: "用户管理", viewSubtitle: "搜索结果为空状态" }
    };
    return copyMap[viewId] || copyMap.userList;
  },

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
