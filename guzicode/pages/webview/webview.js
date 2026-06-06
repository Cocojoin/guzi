Page({
  data: {
    src: ""
  },

  onLoad(options) {
    const src = decodeURIComponent(options.url || "");
    if (!/^https?:\/\//.test(src)) {
      wx.showToast({
        title: "链接无效",
        icon: "none"
      });
      setTimeout(() => wx.navigateBack(), 400);
      return;
    }

    this.setData({ src });
  }
});
