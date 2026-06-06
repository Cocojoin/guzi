// 用户详情页
Page({
  data: {
    // 用户数据
    userData: {
      id: 'u1',
      nickname: '桃桃寄售',
      account: 'taotao88',
      contact: 'taotao_shop',
      rate: 10,
      canConsign: true,
      goodsCount: 36,
      soldCount: 8,
      settledCount: 21
    },

    // 开关状态
    canConsign: true,

    // 编辑弹窗
    showEditPopup: false,
    editField: '',
    editFieldName: '',
    editValue: '',
    errorMsg: '',

    // 确认弹窗
    showConfirmPopup: false,
    confirmTitle: '',
    confirmContent: '',
    confirmBtnText: '',
    confirmActionType: ''
  },

  onLoad(options) {
    // 模拟加载用户数据
    const userId = options.id || 'u1';
    this.loadUserData(userId);
  },

  // 加载用户数据
  loadUserData(userId) {
    // 模拟数据
    const userData = {
      u1: {
        id: 'u1',
        nickname: '桃桃寄售',
        account: 'taotao88',
        contact: 'taotao_shop',
        rate: 10,
        canConsign: true,
        goodsCount: 36,
        soldCount: 8,
        settledCount: 21
      },
      u4: {
        id: 'u4',
        nickname: '月岛前线',
        account: 'tsuki09',
        contact: 'tsuki_front',
        rate: 15,
        canConsign: false,
        goodsCount: 5,
        soldCount: 0,
        settledCount: 12
      }
    };

    const data = userData[userId] || userData.u1;
    this.setData({
      userData: data,
      canConsign: data.canConsign
    });
  },

  // 返回
  goBack() {
    wx.navigateBack();
  },

  // 跳转商品
  goToGoods() {
    wx.navigateTo({
      url: `/admin/pages/users/users?userId=${this.data.userData.id}&view=userGoods`
    });
  },

  // 跳转待结算
  goToSold() {
    wx.navigateTo({
      url: `/admin/pages/users/users?userId=${this.data.userData.id}&view=soldGoods`
    });
  },

  // 跳转已结算
  goToSettled() {
    wx.navigateTo({
      url: `/admin/pages/users/users?userId=${this.data.userData.id}&view=settledList`
    });
  },

  // 点击编辑
  startEdit(e) {
    const field = e.currentTarget.dataset.field || 'nickname';
    const fieldNames = {
      nickname: '昵称',
      contact: '联系方式',
      rate: '抽成比例'
    };
    
    const value = this.data.userData[field] || '';
    
    this.setData({
      showEditPopup: true,
      editField: field,
      editFieldName: fieldNames[field],
      editValue: String(value),
      errorMsg: ''
    });
  },

  // 关闭编辑弹窗
  closeEdit() {
    this.setData({
      showEditPopup: false,
      editField: '',
      editFieldName: '',
      editValue: '',
      errorMsg: ''
    });
  },

  // 输入变化
  onInputChange(e) {
    this.setData({
      editValue: e.detail.value,
      errorMsg: ''
    });
  },

  // 保存编辑
  saveEdit() {
    const { editField, editValue, userData } = this.data;
    let hasError = false;
    let errorMsg = '';

    // 校验
    if (editField === 'nickname') {
      const nickname = editValue.trim();
      if (!nickname) {
        hasError = true;
        errorMsg = '请填写用户昵称';
      } else if (nickname.length > 20) {
        hasError = true;
        errorMsg = '昵称字数不能超过 20 个';
      }
    } else if (editField === 'contact') {
      const contact = editValue.trim();
      if (contact && contact.length > 50) {
        hasError = true;
        errorMsg = '联系方式字数不能超过 50 个';
      }
    } else if (editField === 'rate') {
      const rate = parseInt(editValue);
      if (isNaN(rate) || rate < 0 || rate > 100) {
        hasError = true;
        errorMsg = '请填写正确的抽成比例';
      }
    }

    if (hasError) {
      this.setData({ errorMsg });
      return;
    }

    // 检查抽成是否有变化，如果有变化需要二次确认
    if (editField === 'rate') {
      const newRate = parseInt(editValue);
      if (newRate !== userData.rate) {
        this.closeEdit();
        this.showConfirm({
          title: '修改抽成',
          content: '修改抽成后，仅影响未售出和未结算商品，确认修改吗？',
          btnText: '确认修改',
          actionType: 'rateChange',
          newRate: newRate
        });
        return;
      }
    }

    this.doSaveEdit(editField, editValue);
  },

  // 执行保存
  doSaveEdit(field, value) {
    const { userData } = this.data;
    const updatedUserData = { ...userData };

    if (field === 'nickname') {
      updatedUserData.nickname = value.trim();
    } else if (field === 'contact') {
      updatedUserData.contact = value.trim();
    } else if (field === 'rate') {
      updatedUserData.rate = parseInt(value);
    }

    this.setData({
      userData: updatedUserData,
      showEditPopup: false,
      editField: '',
      editFieldName: '',
      editValue: '',
      errorMsg: ''
    });

    wx.showToast({
      title: '保存成功',
      icon: 'success'
    });
  },

  // 切换寄售权限
  toggleConsign(e) {
    const newState = e.detail.value;
    
    if (!newState) {
      // 关闭权限，需要确认
      this.showConfirm({
        title: '关闭寄售权限？',
        content: '关闭后，该用户已上架商品将全部自动下架，且无法在用户端提交新的寄售。是否关闭？',
        btnText: '确认关闭',
        actionType: 'disableConsign'
      });
    } else {
      // 开启权限
      this.showConfirm({
        title: '开启寄售权限？',
        content: '确认开启该用户的寄售权限吗？已下架商品不会自动重新上架。',
        btnText: '确认开启',
        actionType: 'enableConsign'
      });
    }
  },

  // 显示确认弹窗
  showConfirm({ title, content, btnText, actionType, newRate }) {
    this.setData({
      showConfirmPopup: true,
      confirmTitle: title,
      confirmContent: content,
      confirmBtnText: btnText,
      confirmActionType: actionType,
      pendingNewRate: newRate || null
    });
  },

  // 关闭确认弹窗
  closeConfirm() {
    // 如果是关闭权限操作，需要重置开关状态
    if (this.data.confirmActionType === 'disableConsign') {
      this.setData({ canConsign: true });
    } else if (this.data.confirmActionType === 'enableConsign') {
      this.setData({ canConsign: false });
    }
    
    this.setData({
      showConfirmPopup: false,
      confirmTitle: '',
      confirmContent: '',
      confirmBtnText: '',
      confirmActionType: '',
      pendingNewRate: null
    });
  },

  // 确认操作
  confirmAction() {
    const { confirmActionType, pendingNewRate, userData } = this.data;
    const updatedUserData = { ...userData };

    switch (confirmActionType) {
      case 'rateChange':
        // 修改抽成
        if (pendingNewRate !== null) {
          updatedUserData.rate = pendingNewRate;
          this.setData({ userData: updatedUserData });
        }
        break;
        
      case 'disableConsign':
        // 关闭寄售权限
        updatedUserData.canConsign = false;
        this.setData({
          userData: updatedUserData,
          canConsign: false
        });
        wx.showToast({
          title: '已关闭寄售权限',
          icon: 'success'
        });
        break;
        
      case 'enableConsign':
        // 开启寄售权限
        updatedUserData.canConsign = true;
        this.setData({
          userData: updatedUserData,
          canConsign: true
        });
        wx.showToast({
          title: '已开启寄售权限',
          icon: 'success'
        });
        break;
        
      case 'resetPassword':
        wx.showToast({
          title: '密码已重置为 123456',
          icon: 'success'
        });
        break;
    }

    this.setData({
      showConfirmPopup: false,
      confirmTitle: '',
      confirmContent: '',
      confirmBtnText: '',
      confirmActionType: '',
      pendingNewRate: null
    });
  },

  // 重置密码
  resetPassword() {
    this.showConfirm({
      title: '重置密码',
      content: '确认将该用户密码重置为 123456 吗？',
      btnText: '确认重置',
      actionType: 'resetPassword'
    });
  }
});
