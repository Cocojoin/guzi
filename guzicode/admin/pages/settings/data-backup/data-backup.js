const {
  addOperationLog,
  getBackupConfig,
  getBackupMeta,
  formatFailureContext,
  openDocument,
  runBackup,
  saveBackupConfig,
} = require("../../../../utils/adminSettings");

Page({
  data: {
    lastBackupAt: "--",
    backupStatus: "未备份",
    fileSize: "--",
    recordCount: "--",
    backupFilePath: "",
    autoBackup: true,
    frequencyOptions: ["每日 03:00", "每周一 03:00", "每月 1 日 03:00"],
    selectedFrequency: "每日 03:00",
    backingUp: false
  },

  onShow() {
    const config = getBackupConfig();
    const meta = getBackupMeta();
    this.setData({
      autoBackup: config.autoBackup,
      selectedFrequency: config.selectedFrequency,
      lastBackupAt: meta ? meta.lastBackupAt : "--",
      backupStatus: meta ? "成功" : "未备份",
      fileSize: meta ? meta.fileSize : "--",
      recordCount: meta ? `${meta.recordCount} 条` : "--",
      backupFilePath: meta ? meta.filePath : ""
    });
  },

  handleBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({
          url: "/admin/pages/settings/settings"
        });
      }
    });
  },

  toggleAutoBackup() {
    const autoBackup = !this.data.autoBackup;
    this.setData({ autoBackup });
    saveBackupConfig({
      autoBackup,
      selectedFrequency: this.data.selectedFrequency
    });
    addOperationLog({
      title: autoBackup ? "开启自动备份" : "关闭自动备份",
      target: "备份策略",
      type: "备份",
      note: `当前频率：${this.data.selectedFrequency}`
    });
    wx.showToast({
      title: autoBackup ? "已开启自动备份" : "已关闭自动备份",
      icon: "none"
    });
  },

  chooseFrequency() {
    wx.showActionSheet({
      itemList: this.data.frequencyOptions,
      success: (res) => {
        const selectedFrequency = this.data.frequencyOptions[res.tapIndex];
        this.setData({
          selectedFrequency
        });
        saveBackupConfig({
          autoBackup: this.data.autoBackup,
          selectedFrequency
        });
        addOperationLog({
          title: "修改备份频率",
          target: "备份策略",
          type: "备份",
          note: `调整为 ${selectedFrequency}`
        });
      }
    });
  },

  async runManualBackup() {
    if (this.data.backingUp) {
      return;
    }
    this.setData({ backingUp: true });
    wx.showLoading({
      title: "备份中"
    });

    try {
      const meta = await runBackup();
      wx.hideLoading();
      this.setData({
        lastBackupAt: meta.lastBackupAt,
        backupStatus: "成功",
        fileSize: meta.fileSize,
        recordCount: `${meta.recordCount} 条`,
        backupFilePath: meta.filePath
      });
      wx.showToast({
        title: "备份完成",
        icon: "success"
      });
      setTimeout(() => {
        openDocument(meta.filePath).catch(() => {});
      }, 300);
    } catch (error) {
      console.error("run backup error:", error);
      wx.hideLoading();
      wx.showToast({
        title: "备份失败，请重试",
        icon: "none"
      });
      await addOperationLog({
        title: "执行手动备份",
        target: "数据备份",
        type: "备份",
        note: formatFailureContext(error),
        success: false
      });
    } finally {
      this.setData({ backingUp: false });
    }
  }
});
