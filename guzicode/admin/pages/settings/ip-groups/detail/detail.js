const session = require("../../../../../utils/session");
const { debounce } = require("../../../../../utils/debounce");
const { addOperationLog, formatFailureContext } = require("../../../../../utils/adminSettings");
const { getIpGroupDetail, removeProductsFromIp, deleteIpGroup } = require("../../../../../utils/ipGroupsRepository");

Page({
  data: {
    name: "",
    summary: null,
    goods: [],
    loading: true,
    hasLoaded: false,
    selectedIds: [],
    allChecked: false,
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64
  },

  onLoad(options) {
    const currentSession = session.getSession();
    if (!currentSession || currentSession.role !== "admin") {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }

    try {
      const sysInfo = wx.getSystemInfoSync();
      const menuButton = wx.getMenuButtonBoundingClientRect();
      const statusBarHeight = sysInfo.statusBarHeight || 20;
      const navBarHeight = (menuButton.top - statusBarHeight) * 2 + menuButton.height;
      const contentPaddingTop = statusBarHeight + navBarHeight;
      this.setData({
        name: decodeURIComponent(options.name || ""),
        statusBarHeight: statusBarHeight,
        navBarHeight: navBarHeight,
        contentPaddingTop: contentPaddingTop
      });
    } catch (e) {
      this.setData({
        name: decodeURIComponent(options.name || "")
      });
    }

    this.goBack = debounce(this.goBack.bind(this), 500);
    this.goAssign = debounce(this.goAssign.bind(this), 500);
    this.submitRemove = debounce(this.submitRemove.bind(this), 800);
    this.submitDelete = debounce(this.submitDelete.bind(this), 800);
    this.openGoodsDetail = debounce(this.openGoodsDetail.bind(this), 500);
  },

  onShow() {
    this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const detail = await getIpGroupDetail(this.data.name);
      this.setData({
        summary: detail.summary,
        goods: detail.goods.map((item) => ({
          ...item,
          selected: false
        })),
        loading: false,
        hasLoaded: true,
        selectedIds: [],
        allChecked: false
      });
    } catch (error) {
      console.error("load ip detail error:", error);
      this.setData({
        loading: false,
        hasLoaded: true
      });
      wx.showToast({
        title: "IP 详情加载失败",
        icon: "none"
      });
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: "/admin/pages/settings/ip-groups/ip-groups" });
      }
    });
  },

  goAssign() {
    wx.navigateTo({
      url: `/admin/pages/settings/ip-groups/assign/assign?name=${encodeURIComponent(this.data.name)}`
    });
  },

  toggleSelection(event) {
    const id = event.currentTarget.dataset.id;
    const selected = new Set(this.data.selectedIds);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    const selectedIds = [...selected];
    const allChecked = Boolean(this.data.goods.length && selectedIds.length === this.data.goods.length);
    this.setData({
      selectedIds,
      allChecked,
      goods: this.data.goods.map((item) => ({
        ...item,
        selected: selected.has(item.id)
      }))
    });
  },

  toggleAll() {
    if (this.data.allChecked) {
      this.setData({
        selectedIds: [],
        allChecked: false,
        goods: this.data.goods.map((item) => ({
          ...item,
          selected: false
        }))
      });
      return;
    }
    const selectedIds = this.data.goods.map((item) => item.id);
    this.setData({
      selectedIds,
      allChecked: Boolean(selectedIds.length),
      goods: this.data.goods.map((item) => ({
        ...item,
        selected: true
      }))
    });
  },

  openGoodsDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/admin/pages/goods/detail/detail?id=${id}`
    });
  },

  async submitRemove() {
    if (!this.data.selectedIds.length) {
      wx.showToast({
        title: "请先选择商品",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "移出商品",
      content: `确认将所选 ${this.data.selectedIds.length} 件商品移出该 IP 吗？`,
      confirmText: "确认移出",
      success: async ({ confirm }) => {
        if (!confirm) return;

        try {
          const updated = await removeProductsFromIp(this.data.name, this.data.selectedIds);
          await addOperationLog({
            title: "移除 IP 商品",
            target: this.data.name,
            type: "IP管理",
            note: `移出 ${updated.length} 件商品`
          });
          wx.showToast({
            title: "已移出该 IP",
            icon: "success"
          });
          await this.loadDetail();
        } catch (error) {
          wx.showToast({
            title: "移除失败，请重试",
            icon: "none"
          });
          await addOperationLog({
            title: "移除 IP 商品",
            target: this.data.name,
            type: "IP管理",
            success: false,
            note: formatFailureContext(error, "移出商品失败")
          });
        }
      }
    });
  },

  async submitDelete() {
    if (this.data.goods.length) {
      wx.showToast({
        title: "当前 IP 下仍有商品，无法删除",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "删除空 IP",
      content: "确认删除该空 IP 吗？",
      confirmText: "确认删除",
      confirmColor: "#d84b4b",
      success: async ({ confirm }) => {
        if (!confirm) return;

        try {
          await deleteIpGroup(this.data.name);
          await addOperationLog({
            title: "删除 IP",
            target: this.data.name,
            type: "IP管理",
            note: "删除空 IP"
          });
          wx.showToast({
            title: "IP 已删除",
            icon: "success"
          });
          setTimeout(() => {
            this.goBack();
          }, 300);
        } catch (error) {
          wx.showToast({
            title: error.message || "删除失败，请重试",
            icon: "none"
          });
          await addOperationLog({
            title: "删除 IP",
            target: this.data.name,
            type: "IP管理",
            success: false,
            note: formatFailureContext(error, "删除 IP 失败")
          });
        }
      }
    });
  }
});
