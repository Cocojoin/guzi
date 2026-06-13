App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("当前基础库不支持云开发，请升级微信开发者工具或基础库");
      return;
    }

    wx.cloud.init({
      env: "guzi-8gt2kfqe58854187",
      traceUser: true
    });
  }
});
