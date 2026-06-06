const PRODUCTS_COLLECTION = "products";
const SETTLEMENT_RECORDS_COLLECTION = "settlement_records";
const { addOperationLog, formatFailureContext } = require("../../../utils/adminSettings");
const { navigateAdminRoot } = require("../../../utils/adminNavigation");
const { ensurePendingSoldBatches, getUserRateFraction, normalizeRateFraction, settleSpecificSoldBatch } = require("../../../utils/consignmentRate");
const { ensureCloudImages } = require("../../../utils/cloudFile");
const usersRepository = require("../../../utils/usersRepository");
const authService = require("../../../utils/authService");

function db() {
  return wx.cloud.database();
}

function fmt2(value) {
  return Number(value || 0).toFixed(2);
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

function canDeleteUser(user) {
  return !!(user && user.id);
}

function buildPendingSettlementItems(product, fallbackRateFraction) {
  const pendingBatches = ensurePendingSoldBatches(product, fallbackRateFraction);
  return pendingBatches
    .map((batch, batchIndex) => {
      const unsettledQty = Math.max(0, Number(batch.qty || 0) - Number(batch.settledQty || 0));
      if (!unsettledQty) {
        return null;
      }
      const rateFraction = normalizeRateFraction(batch.rateFraction);
      const price = Number(product.price || 0);
      return {
        id: product._id,
        rowKey: `${product._id}-${batchIndex}`,
        productId: product.id,
        title: `${product.role || ""} · ${product.series || ""}`.trim(),
        soldQty: unsettledQty,
        price,
        totalPrice: price * unsettledQty,
        rate: Number((rateFraction * 100).toFixed(2)),
        rateFraction,
        batchIndex,
        type: product.customType || product.type || "-",
        series: product.ip || product.series || "-",
        quality: product.purchaseRecord || "无",
        selected: true,
        coverImage: Array.isArray(product.images) ? (product.images[0] || "") : ""
      };
    })
    .filter(Boolean);
}

Page({
  data: {
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
    userGoodsStatusOptions: ["全部状态", "已上架", "已下架", "已售出"],
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
    this.setData({ _pageAlive: true });
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
  },

  onHide() {
    this.setData({ _pageAlive: false });
  },

  onShow() {
    this.setData({ _pageAlive: true });
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
      }
    }
  },

  bindNetworkStatus() {
    wx.getNetworkType({
      success: (res) => {
        const online = res.networkType && res.networkType !== "none";
        this.setData({ networkOnline: online });
      }
    });
    this._networkStatusHandler = (res) => {
      const online = !!res.isConnected;
      this.setData({ networkOnline: online });
      if (!online) {
        wx.showToast({ title: "网络已断开", icon: "none" });
      } else {
        wx.showToast({ title: "网络已恢复", icon: "none" });
      }
    };
    wx.onNetworkStatusChange(this._networkStatusHandler);
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
          return db().collection(PRODUCTS_COLLECTION).doc(p._id).update({
            data: {
              ownerUserId,
              updatedAt: new Date()
            }
          });
        })
      );
    } catch (e) {
      console.warn("migrateProductOwnerLinks skipped:", e && e.message);
    }
  },

  async fetchAll(collectionName, where = null) {
    const list = [];
    const pageSize = 100;
    let skip = 0;
    while (true) {
      let query = db().collection(collectionName);
      if (where) query = query.where(where);
      const res = await query.skip(skip).limit(pageSize).get({ latest: true });
      const rows = res.data || [];
      list.push(...rows);
      if (rows.length < pageSize) break;
      skip += pageSize;
    }
    return list;
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
    const users = (this.data.users || []).map((user) => {
      const matched = products.filter((p) => p.ownerUserId === user.id);
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
    const remaining = total - sold;
    // 只有当剩余数量为0时才显示已售出
    if (remaining <= 0 && total > 0) {
      return { label: "已售出", className: "goods-status-pill--sold" };
    }
    // 如果还有可销售数量，返回产品原始状态
    if (product.status === "up" || product.status === "down") {
      return product.status === "up" 
        ? { label: "已上架", className: "goods-status-pill--up" }
        : { label: "已下架", className: "goods-status-pill--down" };
    }
    // 如果商品状态是sold但还有剩余数量，默认返回已上架
    return { label: "已上架", className: "goods-status-pill--up" };
  },

  async loadUserGoodsForCurrentUser() {
    const user = this.data.currentUser;
    if (!user) return;
    const products = await this.fetchAll(PRODUCTS_COLLECTION, { ownerUserId: user.id });
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
        id: p._id,
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
        coverImage,
        status: p.status
      };
    });
    const upCount = userGoodsItems.filter((item) => item.status === "up").length;
    this.setData({
      userGoodsItems,
      viewSubtitle: `${upCount} 件`
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
      this.setData({ currentView: "userDetail", ...this.getViewCopy("userDetail") });
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
        const ownedProducts = products.filter((item) => item.ownerUserId === currentUser.id);
        await Promise.all(
          ownedProducts.map(async (product) => {
            const pendingQty = Math.max(0, Number(product.soldCount || 0) - Number(product.settledCount || 0));
            if (!pendingQty) {
              return;
            }
            const nextBatches = ensurePendingSoldBatches(product, previousRateFraction);
            await db().collection(PRODUCTS_COLLECTION).doc(product._id).update({
              data: {
                soldBatches: nextBatches,
                updatedAt: new Date()
              }
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
      await addOperationLog({
        title: "编辑用户资料",
        target: currentUser.account || currentUser.id,
        type: "用户",
        note: formatFailureContext(e, tempData.nickname || currentUser.nickname || ""),
        success: false
      });
      this.handlePageError(e, "保存失败，请重试");
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
        const userProducts = allProducts.filter((item) => item.ownerUserId === user.id);
        productsToUpdate = userProducts.filter((p) => {
          const totalQuantity = Number(p.totalQuantity || 0);
          const soldCount = Number(p.soldCount || 0);
          const remainingCount = Math.max(0, totalQuantity - soldCount);
          return p.status === "up" && remainingCount > 0;
        });
        
        await Promise.all(
          productsToUpdate.map((item) =>
            db().collection(PRODUCTS_COLLECTION).doc(item._id).update({
              data: {
                status: "down",
                updatedAt: new Date()
              }
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
    this.applyRoleFilter();
  },

  clearKeyword() {
    this.setData({
      keyword: "",
      showRoleDropdown: false,
      showInactiveDropdown: false
    });
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

          await Promise.all(relatedProducts.map((item) => db().collection(PRODUCTS_COLLECTION).doc(item._id).remove()));
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
      const products = await this.fetchAll(PRODUCTS_COLLECTION);
      const soldItems = products
        .filter((p) => p.ownerUserId === user.id && Number(p.soldCount || 0) > Number(p.settledCount || 0))
        .flatMap((p) => buildPendingSettlementItems(p, getUserRateFraction(user)));
      this.setData({ soldItems });
      this.recalcSoldSummary();
    } catch (e) {
      this.handlePageError(e, "待结算商品加载失败");
      this.setData({ soldItems: [], selectedSoldCount: 0, soldTotalPayable: "0.00" });
    }
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
    const selectedItems = this.data.soldItems.filter((item) => item.selected);
    if (!selectedItems.length) {
      wx.showToast({ title: "请先选择商品", icon: "none" });
      return;
    }
    const settlementGross = selectedItems.reduce((sum, item) => sum + item.price * item.soldQty, 0);
    const settlementCommission = selectedItems.reduce((sum, item) => sum + item.price * item.soldQty * item.rateFraction, 0);
    this.setData({
      settlementItems: selectedItems.map((item) => ({
        ...item,
        rateFraction: normalizeRateFraction(item.rateFraction),
        rate: Number(item.rate || 0),
        totalPrice: item.price * item.soldQty
      })),
      settlementGross: fmt2(settlementGross),
      settlementCommission: fmt2(settlementCommission),
      settlementPayable: fmt2(settlementGross - settlementCommission),
      settlementActualIncome: fmt2(settlementGross),
      settlementVouchers: [],
      currentView: "settlement",
      ...this.getViewCopy("settlement")
    });
  },

  onSettlementIncomeInput(event) {
    this.setData({ settlementActualIncome: event.detail.value || "" });
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
    try {
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
          rateFraction: normalizeRateFraction(item.rateFraction),
          rate: Number(item.rate || 0)
        })),
        vouchers: voucherCloudPaths,
        createdAt: now,
        updatedAt: now
      };
      await db().collection(SETTLEMENT_RECORDS_COLLECTION).add({ data: record });
      await Promise.all(
        items.map(async (item) => {
          const product = await db().collection(PRODUCTS_COLLECTION).doc(item.id).get();
          const p = product.data;
          const totalQuantity = Number(p.totalQuantity || 0);
          const soldCount = Number(p.soldCount || 0);
          const nextSettled = Number(p.settledCount || 0) + Number(item.soldQty || 0);
          const remainingCount = Math.max(0, totalQuantity - soldCount);
          
          // 计算新状态：只有当剩余数量为0时才设置为已售出
          let nextStatus = p.status;
          if (remainingCount <= 0 && totalQuantity > 0) {
            nextStatus = "sold";
          } else if (nextStatus === "sold" && remainingCount > 0) {
            // 如果状态是sold但还有剩余数量，恢复为up
            nextStatus = "up";
          }
          
          await db().collection(PRODUCTS_COLLECTION).doc(item.id).update({
            data: {
              settledCount: nextSettled,
              soldBatches: settleSpecificSoldBatch(p, item.batchIndex, Number(item.soldQty || 0), item.rateFraction),
              status: nextStatus,
              updatedAt: new Date()
            }
          });
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
    }
  },

  async loadSettledRecordsForCurrentUser() {
    const user = this.data.currentUser;
    if (!user) return;
    try {
      this.clearPageError();
      const settledRecords = await this.fetchAll(SETTLEMENT_RECORDS_COLLECTION, { userId: user.id });
      // 按 _id 去重，避免重复显示
      const uniqueRecordsMap = new Map();
      settledRecords.forEach(record => {
        if (record._id) {
          uniqueRecordsMap.set(record._id, record);
        }
      });
      const uniqueSettledRecords = Array.from(uniqueRecordsMap.values());
      uniqueSettledRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
      this.setData({ settledRecords: uniqueSettledRecords });
      this.recalcSettledSummary();
    } catch (e) {
      this.setData({ settledRecords: [] });
      this.recalcSettledSummary();
      this.handlePageError(e, "已结算记录加载失败");
      console.warn("loadSettledRecordsForCurrentUser:", e);
    }
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
      totalPrice: item.totalPrice || (item.price * item.soldQty)
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
    const { userGoodsItems, userGoodsStatusIndex } = this.data;
    let filteredUserGoodsItems = userGoodsItems;
    
    if (userGoodsStatusIndex === 1) { // 已上架
      filteredUserGoodsItems = userGoodsItems.filter(item => item.status === "up");
    } else if (userGoodsStatusIndex === 2) { // 已下架
      filteredUserGoodsItems = userGoodsItems.filter(item => item.status === "down");
    } else if (userGoodsStatusIndex === 3) { // 已售出
      filteredUserGoodsItems = userGoodsItems.filter(item => item.status === "sold");
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
