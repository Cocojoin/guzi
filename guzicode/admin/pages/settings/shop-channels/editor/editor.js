const { addOperationLog } = require("../../../../../utils/adminSettings");
const { debounce } = require("../../../../../utils/debounce");
const {
  PLATFORM_DEFINITIONS,
  deleteShopChannel,
  getShopChannelById,
  saveShopChannel
} = require("../../../../../utils/shopChannelsRepository");

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64,
    isEdit: false,
    form: {
      id: "",
      platformKey: "taobao",
      storeName: "",
      enabled: true,
      showInDetail: true
    },
    platformOptions: PLATFORM_DEFINITIONS,
    storeNameCount: 0
  },

  onLoad(options) {
    this.goBack = debounce(this.goBack.bind(this), 500);
    this.handleSubmit = debounce(this.handleSubmit.bind(this), 800);
    this.handleDelete = debounce(this.handleDelete.bind(this), 800);
    this.updateNavMetrics();
    if (options.id) {
      this.loadDetail(options.id);
    }
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

  async loadDetail(id) {
    wx.showLoading({ title: "加载中", mask: true });
    try {
      const channel = await getShopChannelById(id);
      if (!channel) {
        wx.showToast({ title: "店铺不存在", icon: "none" });
        setTimeout(() => this.goBack(), 400);
        return;
      }
      this.setData({
        isEdit: true,
        form: {
          id: channel.id,
          platformKey: channel.platformKey,
          storeName: channel.storeName,
          enabled: channel.enabled,
          showInDetail: channel.showInDetail
        },
        storeNameCount: channel.storeName.length
      });
    } catch (error) {
      wx.showToast({ title: "加载失败，请重试", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  goBack() {
    wx.navigateBack();
  },

  choosePlatform(event) {
    const { key } = event.currentTarget.dataset;
    this.setData({
      "form.platformKey": key
    });
  },

  onStoreNameInput(event) {
    const value = String(event.detail.value || "").slice(0, 20);
    this.setData({
      "form.storeName": value,
      storeNameCount: value.length
    });
  },

  onDetailSwitch(event) {
    this.setData({
      "form.showInDetail": !!event.detail.value
    });
  },

  validateForm() {
    const storeName = String(this.data.form.storeName || "").trim();
    if (!storeName) {
      wx.showToast({ title: "请填写店铺名称", icon: "none" });
      return null;
    }
    if (storeName.length > 20) {
      wx.showToast({ title: "店铺名称不能超过 20 个字", icon: "none" });
      return null;
    }
    return {
      ...this.data.form,
      storeName,
      searchKeyword: storeName
    };
  },

  async handleSubmit() {
    const payload = this.validateForm();
    if (!payload) {
      return;
    }
    try {
      await saveShopChannel(payload);
      await addOperationLog({
        title: this.data.isEdit ? "编辑购买店铺" : "新增购买店铺",
        target: payload.storeName,
        type: "店铺信息设置",
        note: `${payload.platformKey} · ${payload.showInDetail ? "详情展示" : "仅后台保留"}`
      });
      wx.showToast({ title: this.data.isEdit ? "保存成功" : "添加成功", icon: "success" });
      setTimeout(() => this.goBack(), 400);
    } catch (error) {
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    }
  },

  handleDelete() {
    if (!this.data.isEdit || !this.data.form.id) {
      return;
    }
    wx.showModal({
      title: "删除店铺",
      content: "删除后将不再出现在详情页展示中，确认删除吗？",
      confirmText: "删除",
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }
        try {
          const current = this.data.form;
          await deleteShopChannel(current.id);
          await addOperationLog({
            title: "删除购买店铺",
            target: current.storeName,
            type: "店铺信息设置",
            note: current.platformKey
          });
          wx.showToast({ title: "删除成功", icon: "success" });
          setTimeout(() => this.goBack(), 400);
        } catch (error) {
          wx.showToast({ title: "删除失败，请重试", icon: "none" });
        }
      }
    });
  }
});
