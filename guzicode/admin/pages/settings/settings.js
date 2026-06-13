const session = require("../../../utils/session");
const { addOperationLog } = require("../../../utils/adminSettings");
const { navigateAdminRoot } = require("../../../utils/adminNavigation");
const { debounce } = require("../../../utils/debounce");

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64,
    profile: {
      name: "谷圈星社 · 管理员",
      account: "admin@guquan",
      roleLabel: "超级管理员",
      initial: "谷"
    },
    systemItems: [
      {
        key: "ip-groups",
        title: "IP管理",
        subtitle: "新增IP、调整商品归属、删除IP",
        accentClass: "setting-icon--rose",
        iconText: "IP"
      },
      {
        key: "operation-log",
        title: "操作日志",
        subtitle: "操作记录、异常行为追溯",
        accentClass: "setting-icon--violet",
        iconText: "记"
      },
      {
        key: "data-backup",
        title: "数据备份",
        subtitle: "最近备份、自动 / 手动",
        accentClass: "setting-icon--blue",
        iconText: "备"
      },
      {
        key: "export-data",
        title: "导出数据",
        subtitle: "用户 / 商品 / 统计 · Excel",
        accentClass: "setting-icon--mint",
        iconText: "导"
      }
    ],
    aboutItems: [
      {
        key: "version",
        title: "版本",
        value: "v1.7.0"
      },
      {
        key: "help",
        title: "帮助与反馈"
      }
    ]
  },

  onLoad() {
    this.goStats = debounce(this.goStats.bind(this), 500);
    this.goGoods = debounce(this.goGoods.bind(this), 500);
    this.goUsers = debounce(this.goUsers.bind(this), 500);
    this.goSettings = debounce(this.goSettings.bind(this), 500);
    this.openSettingDetail = debounce(this.openSettingDetail.bind(this), 500);
    this.handleLogout = debounce(this.handleLogout.bind(this), 800);
  },

  onShow() {
    const currentSession = session.getSession();
    if (!currentSession || currentSession.role !== "admin") {
      wx.reLaunch({
        url: "/auth/pages/login/login"
      });
      return;
    }

    const sysInfo = wx.getSystemInfoSync();
    const menuBtn = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = sysInfo.statusBarHeight || 20;
    const capGap = menuBtn ? (menuBtn.top - statusBarHeight) * 2 : 8;
    const navBarHeight = menuBtn ? menuBtn.height + capGap : 44;
    const contentPaddingTop = statusBarHeight + navBarHeight;

    this.setData({
      statusBarHeight,
      navBarHeight,
      contentPaddingTop,
      profile: {
        name: "谷圈星社 · 管理员",
        account: `${currentSession.account}@guquan`,
        roleLabel: "超级管理员",
        initial: "谷"
      }
    });
  },

  goStats() {
    navigateAdminRoot("/admin/pages/stats/stats");
  },

  goGoods() {
    navigateAdminRoot("/admin/pages/goods/list/list");
  },

  goUsers() {
    navigateAdminRoot("/admin/pages/users/users");
  },

  goSettings() {
    navigateAdminRoot("/admin/pages/settings/settings");
  },

  openSettingDetail(event) {
    const { key } = event.currentTarget.dataset;
    const routeMap = {
      "ip-groups": "/admin/pages/settings/ip-groups/ip-groups",
      "operation-log": "/admin/pages/settings/operation-log/operation-log",
      "data-backup": "/admin/pages/settings/data-backup/data-backup",
      "export-data": "/admin/pages/settings/export-data/export-data"
    };
    const url = routeMap[key];
    if (!url) {
      return;
    }
    wx.navigateTo({ url });
  },

  handleAboutTap(event) {
    const { key } = event.currentTarget.dataset;
    if (key === "version") {
      wx.showToast({
        title: "当前已是最新版本",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "帮助与反馈",
      content: "如需反馈问题，请联系产品与技术支持。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  handleLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确认退出当前账号吗？",
      confirmText: "退出",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        addOperationLog({
          title: "退出登录",
          target: currentSessionLabel(this.data.profile),
          type: "登录",
          note: "管理员主动退出系统"
        });
        session.clearSession();

        wx.showToast({
          title: "已退出登录",
          icon: "success"
        });

        setTimeout(() => {
          wx.reLaunch({
            url: "/auth/pages/login/login"
          });
        }, 300);
      }
    });
  }
});

function currentSessionLabel(profile) {
  return profile && profile.account ? profile.account : "admin";
}
