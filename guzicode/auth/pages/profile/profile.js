const authService = require("../../../utils/authService");
const session = require("../../../utils/session");

function getAvatarText(nickname, account) {
  const preferred = String(nickname || "").trim() || String(account || "").trim();
  return preferred ? preferred.slice(0, 1) : "☺";
}

function validateNickname(value) {
  if (!value) {
    return "请输入昵称";
  }

  if (!/^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(value)) {
    return "昵称仅支持中文、英文或数字";
  }

  if (value.length > 12) {
    return "昵称不能超过12个字";
  }

  return "";
}

Page({
  data: {
    avatarText: "☺",
    nickname: "",
    errors: {
      nickname: ""
    },
    submitting: false
  },

  onShow() {
    const current = session.getSession();
    if (!current) {
      wx.reLaunch({
        url: "/auth/pages/login/login"
      });
      return;
    }

    if (!this.data.nickname) {
      const account = String(current.account || "").trim();
      this.setData({
        nickname: account,
        avatarText: getAvatarText("", account)
      });
    }
  },

  goBack() {
    const pages = getCurrentPages();
    const previousPage = pages.length > 1 ? pages[pages.length - 2] : null;
    const previousRoute = previousPage && previousPage.route ? previousPage.route : "";

    if (previousRoute === "auth/pages/register/register") {
      session.clearSession();
      wx.navigateBack({
        delta: 1,
        fail: () => {
          session.clearSession();
          wx.reLaunch({
            url: "/auth/pages/login/login"
          });
        }
      });
      return;
    }

    session.clearSession();
    wx.reLaunch({
      url: "/auth/pages/login/login"
    });
  },

  onNicknameInput(event) {
    const nickname = event.detail.value;
    const current = session.getSession();
    this.setData({
      nickname,
      avatarText: getAvatarText(nickname, current && current.account),
      "errors.nickname": ""
    });
  },

  onNicknameBlur() {
    this.setData({
      "errors.nickname": validateNickname(this.data.nickname)
    });
  },

  async handleSubmit() {
    const nicknameError = validateNickname(this.data.nickname);
    const current = session.getSession();
    const userId = current && current.userId;

    this.setData({
      "errors.nickname": nicknameError
    });

    if (nicknameError) {
      return;
    }

    if (!userId) {
      wx.showToast({
        title: "请先登录或注册",
        icon: "none"
      });
      return;
    }

    this.setData({ submitting: true });

    try {
      await authService.updateProfile(userId, this.data.nickname, "");

      this.setData({
        submitting: false
      });
      wx.showToast({
        title: "资料保存成功",
        icon: "success"
      });
      setTimeout(() => {
        wx.reLaunch({
          url: session.getHomePathByRole(current.role)
        });
      }, 400);
    } catch (error) {
      console.error("资料保存失败", error);
      this.setData({ submitting: false });
      wx.showToast({
        title: "保存失败，请重试",
        icon: "none"
      });
    }
  }
});
