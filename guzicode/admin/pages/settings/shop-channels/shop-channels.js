const { addOperationLog } = require("../../../../utils/adminSettings");
const { debounce } = require("../../../../utils/debounce");
const {
  getContactServiceSetting,
  listShopChannels,
  reorderShopChannels,
  saveContactServiceSetting,
  saveShopChannel
} = require("../../../../utils/shopChannelsRepository");

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64,
    channels: [],
    contactServiceEnabled: true,
    sortMode: false
  },

  onLoad() {
    this.goBack = debounce(this.goBack.bind(this), 500);
    this.goCreate = debounce(this.goCreate.bind(this), 500);
  },

  async onShow() {
    this.updateNavMetrics();
    await this.loadChannels();
  },

  updateNavMetrics() {
    const sysInfo = wx.getSystemInfoSync();
    const menuBtn = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = sysInfo.statusBarHeight || 20;
    const capGap = menuBtn ? (menuBtn.top - statusBarHeight) * 2 : 8;
    const navBarHeight = menuBtn ? menuBtn.height + capGap : 44;
    const contentPaddingTop = statusBarHeight + navBarHeight;
    this.setData({ statusBarHeight, navBarHeight, contentPaddingTop });
  },

  async loadChannels() {
    wx.showLoading({ title: "加载中", mask: true });
    try {
      const [channels, previewChannels] = await Promise.all([
        listShopChannels(),
        getContactServiceSetting()
      ]);
      this.setData({
        channels,
        contactServiceEnabled: previewChannels.enabled !== false
      });
    } catch (error) {
      wx.showToast({ title: "店铺数据加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/admin/pages/settings/settings" })
    });
  },

  goCreate() {
    wx.navigateTo({ url: "/admin/pages/settings/shop-channels/editor/editor" });
  },

  openEditor(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/admin/pages/settings/shop-channels/editor/editor?id=${id}`
    });
  },

  async toggleChannelEnabled(event) {
    const { id } = event.currentTarget.dataset;
    const currentEnabled = String(event.currentTarget.dataset.enabled || "") === "1";
    const value = event.detail && typeof event.detail.value === "boolean"
      ? event.detail.value
      : !currentEnabled;
    const channel = this.data.channels.find((item) => item.id === id);
    if (!channel) {
      return;
    }
    try {
      await saveShopChannel({
        ...channel,
        enabled: !!value
      });
      await addOperationLog({
        title: "修改购买店铺状态",
        target: channel.storeName || channel.platformLabel,
        type: "店铺信息设置",
        note: `${channel.platformLabel} ${value ? "启用" : "停用"}`
      });
      await this.loadChannels();
    } catch (error) {
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    }
  },

  async toggleContactService(event) {
    const currentEnabled = String(event.currentTarget.dataset.enabled || "") === "1";
    const enabled = event.detail && typeof event.detail.value === "boolean"
      ? !!event.detail.value
      : !currentEnabled;
    try {
      await saveContactServiceSetting(enabled);
      await addOperationLog({
        title: "修改客服模块状态",
        target: "联系客服模块",
        type: "店铺信息设置",
        note: enabled ? "详情页显示客服入口" : "详情页隐藏客服入口"
      });
      this.setData({
        contactServiceEnabled: enabled
      });
    } catch (error) {
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    }
  },

  toggleSortMode() {
    this.setData({
      sortMode: !this.data.sortMode
    });
  },

  async moveChannel(event) {
    const { id, direction } = event.currentTarget.dataset;
    const currentIndex = this.data.channels.findIndex((item) => item.id === id);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= this.data.channels.length) {
      return;
    }
    const nextIds = this.data.channels.map((item) => item.id);
    const [moved] = nextIds.splice(currentIndex, 1);
    nextIds.splice(targetIndex, 0, moved);
    try {
      await reorderShopChannels(nextIds);
      await addOperationLog({
        title: "购买店铺排序",
        target: id,
        type: "店铺信息设置",
        note: direction === "up" ? "上移店铺" : "下移店铺"
      });
      await this.loadChannels();
    } catch (error) {
      wx.showToast({ title: "排序失败，请重试", icon: "none" });
    }
  },

  copyKeyword(event) {
    const { text } = event.currentTarget.dataset;
    if (!text) {
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: "店铺名已复制",
          icon: "none"
        });
      }
    });
  },

  noop() {}
});
