const authService = require("../../../utils/authService");
const session = require("../../../utils/session");

function getFileExtension(filePath) {
  const match = filePath.match(/\.([A-Za-z0-9]+)(?:\?|$)/);
  return match ? match[1] : "jpg";
}

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
    avatarUrl: "",
    avatarText: "☺",
    nickname: "",
    errors: {
      avatar: "",
      nickname: ""
    },
    submitting: false
  },

  onShow() {
    const current = session.getSession();
    if (!current) {
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

  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      success: (result) => {
        const file = result.tempFiles[0];
        if (file.size > 5 * 1024 * 1024) {
          this.setData({
            "errors.avatar": "头像图片不能超过5M"
          });
          return;
        }

        this.setData({
          avatarUrl: file.tempFilePath,
          "errors.avatar": ""
        });
      },
      fail: (error) => {
        if (error.errMsg && error.errMsg.includes("cancel")) {
          return;
        }

        this.setData({
          "errors.avatar": "头像上传失败，请重新选择"
        });
      }
    });
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({
          url: "/auth/pages/login/login"
        });
      }
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

  async uploadAvatarIfNeeded(userId) {
    if (!this.data.avatarUrl || this.data.avatarUrl.startsWith("cloud://")) {
      return this.data.avatarUrl;
    }

    const extension = getFileExtension(this.data.avatarUrl);
    const uploadResult = await wx.cloud.uploadFile({
      cloudPath: `avatars/${userId}-${Date.now()}.${extension}`,
      filePath: this.data.avatarUrl
    });

    return uploadResult.fileID;
  },

  async handleSubmit() {
    const nicknameError = validateNickname(this.data.nickname);
    const current = session.getSession();
    const userId = current && current.userId;

    this.setData({
      "errors.nickname": nicknameError
    });

    if (nicknameError || this.data.errors.avatar) {
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
      const avatarUrl = await this.uploadAvatarIfNeeded(userId);

      await authService.updateProfile(userId, this.data.nickname, avatarUrl);

      this.setData({
        avatarUrl,
        submitting: false
      });
      wx.showToast({
        title: "资料保存成功",
        icon: "success"
      });
      setTimeout(() => {
        wx.reLaunch({
          url: "/user/pages/goods/list/list"
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
