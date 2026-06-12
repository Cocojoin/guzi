const session = require("../../../../utils/session");
const authService = require("../../../../utils/authService");
const { debounce } = require("../../../../utils/debounce");

Page({
  data: {
    form: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: ""
    },
    submitting: false,
    errors: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: ""
    },
    visible: {
      oldPassword: false,
      newPassword: false,
      confirmPassword: false
    },
    submitting: false,
    canSubmit: false
  },

  onFieldInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [`form.${field}`]: event.detail.value }, () => {
      this.validateFields();
    });
  },

  toggleVisible(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [`visible.${field}`]: !this.data.visible[field] });
  },

  validate() {
    const { oldPassword, newPassword, confirmPassword } = this.data.form;
    if (!oldPassword) return "请输入原密码";
    if (!newPassword) return "请输入新密码";
    if (newPassword.length < 6 || newPassword.length > 20) return "新密码长度需为6-20位";
    if (newPassword === oldPassword) return "新密码不能与原密码相同";
    if (!confirmPassword) return "请再次输入新密码";
    if (confirmPassword !== newPassword) return "两次输入的新密码不一致";
    return "";
  },

  validateFields() {
    const { oldPassword, newPassword, confirmPassword } = this.data.form;
    const errors = {
      oldPassword: oldPassword ? "" : "",
      newPassword: "",
      confirmPassword: ""
    };

    if (newPassword && (newPassword.length < 6 || newPassword.length > 20)) {
      errors.newPassword = "新密码长度需为6-20位";
    } else if (newPassword && newPassword === oldPassword) {
      errors.newPassword = "新密码不能与原密码相同";
    }

    if (confirmPassword && confirmPassword !== newPassword) {
      errors.confirmPassword = "两次输入的新密码不一致";
    }

    const canSubmit = Boolean(
      oldPassword &&
      newPassword &&
      confirmPassword &&
      !errors.newPassword &&
      !errors.confirmPassword &&
      newPassword === confirmPassword &&
      newPassword !== oldPassword &&
      newPassword.length >= 6 &&
      newPassword.length <= 20
    );

    this.setData({ errors, canSubmit });
  },

  async submit() {
    if (this.data.submitting) return;
    const message = this.validate();
    if (message) {
      this.validateFields();
      wx.showToast({ title: message, icon: "none" });
      return;
    }

    const current = session.getSession();
    if (!current) {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }

    this.setData({ submitting: true });
    try {
      await authService.changePassword(current.userId, this.data.form.oldPassword, this.data.form.newPassword);
      session.clearSession();
      wx.showToast({ title: "密码修改成功", icon: "success" });
      setTimeout(() => wx.reLaunch({ url: "/auth/pages/login/login" }), 600);
    } catch (error) {
      wx.showToast({ title: (error && error.message) || (error && error.userMessage) || "修改失败，请稍后重试", icon: "none" });
      this.setData({ submitting: false });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
