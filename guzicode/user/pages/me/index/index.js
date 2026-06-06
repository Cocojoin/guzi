const session = require("../../../../utils/session");
const usersRepository = require("../../../../utils/usersRepository");

Page({
  data: {
    user: null,
    avatarText: "柚",
    consignmentDesc: "查看寄售说明与开通方式"
  },

  async onShow() {
    const current = session.getSession();
    if (!current) {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }

    try {
      const user = await usersRepository.getUserById(current.userId);
      const nickname = String((user && user.nickname) || current.account || "柚子糖不甜");
      const enabled = !!(user && user.isAgentEnabled);
      this.setData({
        user: { ...user, account: current.account, nickname },
        avatarText: nickname.slice(0, 1),
        consignmentDesc: enabled ? "寄售商品 · 出售 · 结算" : "查看寄售说明与开通方式"
      });
    } catch (error) {
      wx.showToast({ title: "用户信息加载失败", icon: "none" });
    }
  },

  goPassword() {
    wx.navigateTo({ url: "/user/pages/me/password/password" });
  },

  async goConsignment() {
    const current = session.getSession();
    if (!current) {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }

    try {
      const user = await usersRepository.getUserById(current.userId);
      const url = user && user.isAgentEnabled
        ? "/user/pages/consignment/home/home"
        : "/user/pages/consignment/intro/intro";
      wx.navigateTo({ url });
    } catch (error) {
      wx.showToast({ title: "寄售信息加载失败", icon: "none" });
    }
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确认退出当前账号吗？",
      success: ({ confirm }) => {
        if (!confirm) {
          return;
        }

        session.clearSession();
        wx.reLaunch({
          url: "/auth/pages/login/login"
        });
      }
    });
  }
});
