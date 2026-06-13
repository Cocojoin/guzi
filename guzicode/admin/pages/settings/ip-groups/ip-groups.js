const session = require("../../../../utils/session");
const { debounce } = require("../../../../utils/debounce");
const { addOperationLog, formatFailureContext } = require("../../../../utils/adminSettings");
const { listIpGroups, createIpGroup } = require("../../../../utils/ipGroupsRepository");

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64,
    groups: [],
    stats: {
      groupCount: 0,
      goodsCount: 0,
      onSaleCount: 0
    },
    loading: true,
    hasLoaded: false,
    showCreateModal: false,
    newIpName: "",
    submitting: false
  },

  onLoad() {
    this.goBack = debounce(this.goBack.bind(this), 500);
    this.openCreateModal = debounce(this.openCreateModal.bind(this), 500);
    this.submitCreate = debounce(this.submitCreate.bind(this), 800);
    this.goDetail = debounce(this.goDetail.bind(this), 500);

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
  },

  onShow() {
    this.loadGroups();
  },

  onPullDownRefresh() {
    this.loadGroups().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadGroups() {
    this.setData({ loading: true });
    try {
      const groups = await listIpGroups();
      const stats = groups.reduce((result, item) => {
        result.groupCount += 1;
        result.goodsCount += Number(item.goodsCount || 0);
        result.onSaleCount += Number(item.onSaleCount || 0);
        return result;
      }, { groupCount: 0, goodsCount: 0, onSaleCount: 0 });

      this.setData({
        groups,
        stats,
        loading: false,
        hasLoaded: true
      });
    } catch (error) {
      console.error("load ip groups error:", error);
      this.setData({
        loading: false,
        hasLoaded: true
      });
      wx.showToast({
        title: "IP 数据加载失败",
        icon: "none"
      });
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: "/admin/pages/settings/settings" });
      }
    });
  },

  openCreateModal() {
    this.setData({
      showCreateModal: true,
      newIpName: ""
    });
  },

  closeCreateModal() {
    if (this.data.submitting) return;
    this.setData({
      showCreateModal: false,
      newIpName: ""
    });
  },

  onNameInput(event) {
    this.setData({
      newIpName: event.detail.value
    });
  },

  async submitCreate() {
    const name = String(this.data.newIpName || "").trim();
    if (!name) {
      wx.showToast({
        title: "请输入 IP 名称",
        icon: "none"
      });
      return;
    }

    if (this.data.submitting) return;

    this.setData({ submitting: true });
    try {
      await createIpGroup(name);
      await addOperationLog({
        title: "新增 IP",
        target: name,
        type: "IP管理",
        note: "管理员手动新增空 IP"
      });
      this.setData({
        showCreateModal: false,
        newIpName: ""
      });
      wx.showToast({
        title: "IP 已新增",
        icon: "success"
      });
      await this.loadGroups();
    } catch (error) {
      wx.showToast({
        title: error.message || "新增失败，请重试",
        icon: "none"
      });
      await addOperationLog({
        title: "新增 IP",
        target: name || "未填写",
        type: "IP管理",
        success: false,
        note: formatFailureContext(error, "新增 IP 失败")
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goDetail(event) {
    const name = event.currentTarget.dataset.name;
    if (!name) return;
    wx.navigateTo({
      url: `/admin/pages/settings/ip-groups/detail/detail?name=${encodeURIComponent(name)}`
    });
  }
});
