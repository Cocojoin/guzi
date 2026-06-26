const authService = require("../../../utils/authService");
const session = require("../../../utils/session");
const { addOperationLog } = require("../../../utils/adminSettings");
const { buildShareAppMessage, buildShareTimeline, enableShareMenus } = require("../../../utils/share");

function validateAccount(value) {
  if (!value) {
    return "请输入账号";
  }

  if (value !== "admin" && !/^[A-Za-z\d]{6,20}$/.test(value)) {
    return "账号需为6-20位字母或数字";
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

function normalizeSubmittedForm(submittedForm = {}, currentForm = {}) {
  const submittedAccount = typeof submittedForm.account === "string" ? submittedForm.account : "";
  const submittedPassword = typeof submittedForm.password === "string" ? submittedForm.password : "";

  return {
    account: submittedAccount || currentForm.account || "",
    password: submittedPassword || currentForm.password || ""
  };
}

Page({
  data: {
    form: {
      account: "",
      password: ""
    },
    errors: {
      account: "",
      password: ""
    },
    passwordVisible: false,
    submitting: false
  },

  onShow() {
    const currentSession = session.getSession();
    if (!currentSession) {
      enableShareMenus();
      return;
    }

    wx.reLaunch({
      url: session.getHomePathByRole(currentSession.role)
    });
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
      "errors.password": ""
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

  togglePassword() {
    this.setData({
      passwordVisible: !this.data.passwordVisible
    });
  },

  async handleLogin(event) {
    const form = normalizeSubmittedForm(event && event.detail ? event.detail.value : {}, this.data.form);
    const accountError = validateAccount(form.account);
    const passwordError = validatePassword(form.password);

    this.setData({
      form,
      "errors.account": accountError,
      "errors.password": passwordError
    });

    if (accountError || passwordError) {
      return;
    }

    this.setData({ submitting: true });

    try {
      const user = await authService.login(form.account, form.password);

      session.setSession({
        userId: user._id,
        account: user.account,
        role: user.role
      });

      this.setData({ submitting: false });
      if (user.role === "admin") {
        addOperationLog({
          title: "登录",
          target: "管理端",
          type: "登录",
          note: "管理员登录成功"
        });
      }
      wx.showToast({
        title: user.role === "admin" ? "管理员登录成功" : "登录成功",
        icon: "success"
      });
      setTimeout(() => {
        wx.reLaunch({
          url: session.getHomePathByRole(user.role)
        });
      }, 400);
    } catch (error) {
      console.error("登录失败", error);
      this.setData({ submitting: false });
      const message = error && error.message ? error.message : (error && error.userMessage) || "登录失败，请重试";
      if (message.includes("账号不存在")) {
        this.setData({ "errors.account": message });
        return;
      }
      if (message.includes("密码错误")) {
        this.setData({ "errors.password": message });
        return;
      }
      wx.showToast({ title: (error && error.userMessage) || message, icon: "none" });
    }
  },

  goRegister() {
    wx.navigateTo({
      url: "/auth/pages/register/register"
    });
  },

  onShareAppMessage() {
    return buildShareAppMessage({
      title: "谷圈星社 | 登录后查看寄售与收藏",
      path: "/auth/pages/login/login"
    });
  },

  onShareTimeline() {
    return buildShareTimeline({
      title: "谷圈星社 | 登录后查看寄售与收藏"
    });
  }
});
