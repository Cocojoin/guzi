const authService = require("../../../utils/authService");
const session = require("../../../utils/session");
const { buildShareAppMessage, buildShareTimeline, enableShareMenus } = require("../../../utils/share");

function validateAccount(value) {
  if (!value) {
    return "请输入账号";
  }

  if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,20}$/.test(value)) {
    return "账号需为6-20位数字和字母组合";
  }

  return "";
}

function validatePassword(value) {
  if (!value) {
    return "请输入密码";
  }

  if (!/^[A-Za-z\d]{6,12}$/.test(value)) {
    return "密码需为6-12位数字或字母";
  }

  return "";
}

function validateConfirmPassword(password, confirmPassword) {
  if (!confirmPassword) {
    return "请再次输入密码";
  }

  if (password !== confirmPassword) {
    return "两次输入的密码不一致";
  }

  return "";
}

Page({
  data: {
    form: {
      account: "",
      password: "",
      confirmPassword: ""
    },
    errors: {
      account: "",
      password: "",
      confirmPassword: ""
    },
    passwordVisible: false,
    confirmPasswordVisible: false,
    submitting: false
  },

  onLoad() {
    enableShareMenus();
  },

  onAccountInput(event) {
    this.setData({
      "form.account": event.detail.value,
      "errors.account": ""
    });
  },

  onPasswordInput(event) {
    this.setData({
      "form.password": event.detail.value,
      "errors.password": "",
      "errors.confirmPassword": ""
    });
  },

  onConfirmPasswordInput(event) {
    this.setData({
      "form.confirmPassword": event.detail.value,
      "errors.confirmPassword": ""
    });
  },

  onAccountBlur() {
    this.setData({
      "errors.account": validateAccount(this.data.form.account)
    });
  },

  onPasswordBlur() {
    this.setData({
      "errors.password": validatePassword(this.data.form.password)
    });
  },

  onConfirmPasswordBlur() {
    this.setData({
      "errors.confirmPassword": validateConfirmPassword(
        this.data.form.password,
        this.data.form.confirmPassword
      )
    });
  },

  togglePassword() {
    this.setData({
      passwordVisible: !this.data.passwordVisible
    });
  },

  toggleConfirmPassword() {
    this.setData({
      confirmPasswordVisible: !this.data.confirmPasswordVisible
    });
  },

  async handleRegister() {
    const accountError = validateAccount(this.data.form.account);
    const passwordError = validatePassword(this.data.form.password);
    const confirmPasswordError = validateConfirmPassword(
      this.data.form.password,
      this.data.form.confirmPassword
    );

    this.setData({
      "errors.account": accountError,
      "errors.password": passwordError,
      "errors.confirmPassword": confirmPasswordError
    });

    if (accountError || passwordError || confirmPasswordError) {
      return;
    }

    this.setData({ submitting: true });

    try {
      const user = await authService.register(this.data.form.account, this.data.form.password);

      session.setSession({
        userId: user._id,
        account: user.account,
        role: user.role
      });

      this.setData({ submitting: false });
      wx.showToast({
        title: "注册成功",
        icon: "success"
      });
      wx.navigateTo({
        url: "/auth/pages/profile/profile"
      });
    } catch (error) {
      console.error("注册失败", error);
      this.setData({ submitting: false });
      const message = error && error.message ? error.message : (error && error.userMessage) || "注册失败，请重试";
      if (message.includes("账号已存在") || (error && error.code === "DEFAULT_NICKNAME_EXISTS")) {
        this.setData({ "errors.account": message });
        return;
      }
      wx.showToast({ title: (error && error.userMessage) || message, icon: "none" });
    }
  },

  goLogin() {
    session.clearSession();
    wx.navigateBack({
      delta: 1
    });
  },

  onShareAppMessage() {
    return buildShareAppMessage({
      title: "谷圈星社 | 注册账号开始记录喜欢",
      path: "/auth/pages/register/register"
    });
  },

  onShareTimeline() {
    return buildShareTimeline({
      title: "谷圈星社 | 注册账号开始记录喜欢"
    });
  }
});
