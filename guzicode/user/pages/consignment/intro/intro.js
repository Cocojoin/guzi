const { debounce } = require("../../../../utils/debounce");

Page({
  goBack() {
    wx.navigateBack();
  }
});
