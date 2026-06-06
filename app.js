/**
 * 谷圈星社 - 寄售小程序管理端用户管理
 * 基于需求文档 v1.7 开发
 */

// ==================== 数据模型 ====================

// 模拟用户数据
const mockUsers = [
  {
    id: 1,
    nickname: '桃桃寄售',
    account: 'taotao88',
    contact: 'taotao_shop',
    avatar: '桃',
    role: 'consignor',
    rate: 10,
    canConsign: true,
    registerTime: '2026-05-18',
    goodsCount: 36,
    soldCount: 8,
    settledCount: 21
  },
  {
    id: 2,
    nickname: '星社补货组',
    account: 'hoshi24',
    contact: 'hoshi_staff',
    avatar: '星',
    role: 'consignor',
    rate: 12,
    canConsign: true,
    registerTime: '2026-05-15',
    goodsCount: 128,
    soldCount: 23,
    settledCount: 89
  },
  {
    id: 3,
    nickname: '小葵收藏家',
    account: 'aoi777',
    contact: 'aoi_collect',
    avatar: '葵',
    role: 'normal',
    rate: 0,
    canConsign: false,
    registerTime: '2026-05-20',
    goodsCount: 0,
    soldCount: 0,
    settledCount: 0
  },
  {
    id: 4,
    nickname: '月岛前线',
    account: 'tsuki09',
    contact: 'tsuki_front',
    avatar: '月',
    role: 'consignor',
    rate: 15,
    canConsign: false,
    registerTime: '2026-05-10',
    goodsCount: 5,
    soldCount: 0,
    settledCount: 12
  }
];

// 模拟商品数据
const mockGoods = [
  {
    id: 101,
    userId: 1,
    name: '流萤 · 星穹铁道镭射票',
    ip: '崩坏星穹铁道',
    type: '镭射票',
    price: 68,
    quantity: 2,
    status: 'on_sale',
    soldQuantity: 0,
    soldRate: 10
  },
  {
    id: 102,
    userId: 1,
    name: '芙宁娜 · 周边拍立得',
    ip: '原神',
    type: '拍立得',
    price: 45,
    quantity: 1,
    status: 'off_sale',
    soldQuantity: 0,
    soldRate: 10
  },
  {
    id: 103,
    userId: 1,
    name: '宫侑 · 稻荷崎吧唧',
    ip: '排球少年',
    type: '吧唧',
    price: 45,
    quantity: 3,
    status: 'sold',
    soldQuantity: 2,
    soldRate: 10
  },
  {
    id: 104,
    userId: 1,
    name: '流萤 · 星旅票',
    ip: '崩坏星穹铁道',
    type: '镭射票',
    price: 68,
    quantity: 1,
    status: 'sold',
    soldQuantity: 1,
    soldRate: 10
  },
  {
    id: 105,
    userId: 1,
    name: '及川彻 · 青城吧唧',
    ip: '排球少年',
    type: '吧唧',
    price: 55,
    quantity: 1,
    status: 'settled',
    soldQuantity: 1,
    soldRate: 10
  }
];

// 模拟结算记录
const mockSettlements = [
  {
    id: 'S001',
    userId: 1,
    date: '2026-05-28',
    goodsCount: 5,
    totalAmount: 420,
    commission: 42,
    actualIncome: 438,
    payable: 378,
    goods: [101, 102, 103, 104, 105],
    vouchers: ['voucher1.jpg', 'voucher2.jpg']
  },
  {
    id: 'S002',
    userId: 1,
    date: '2026-05-21',
    goodsCount: 3,
    totalAmount: 266,
    commission: 26.6,
    actualIncome: 280,
    payable: 239.4,
    goods: [101, 102],
    vouchers: ['voucher3.jpg']
  },
  {
    id: 'S003',
    userId: 1,
    date: '2026-05-12',
    goodsCount: 8,
    totalAmount: 612,
    commission: 61.2,
    actualIncome: 650,
    payable: 550.8,
    goods: [103, 104, 105],
    vouchers: []
  }
];

// ==================== 状态管理 ====================

const state = {
  currentPage: 'userList',
  currentUser: null,
  users: [...mockUsers],
  goods: [...mockGoods],
  settlements: [...mockSettlements],
  searchKeyword: '',
  roleFilter: 'all',
  selectedGoods: [],
  editingUser: false,
  editingField: null,
  tempUserData: {}
};

// ==================== 工具函数 ====================

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function formatMoney(amount) {
  return '¥' + amount.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  return dateStr;
}

function showToast(message, duration = 3000) {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, duration);
}

function showDialog({ title, text, confirmText = '确认', cancelText = '取消', onConfirm, onCancel, singleButton = false }) {
  const container = $('#dialog-container');
  
  const dialogHTML = `
    <div class="dialog-mask" id="dialog-mask">
      <div class="dialog">
        <div class="dialog-title">${title}</div>
        <div class="dialog-text">${text}</div>
        <div class="dialog-actions ${singleButton ? 'single' : ''}">
          ${singleButton ? '' : `<button class="button secondary small" id="dialog-cancel">${cancelText}</button>`}
          <button class="button small" id="dialog-confirm">${confirmText}</button>
        </div>
      </div>
    </div>
  `;
  
  container.innerHTML = dialogHTML;
  
  const mask = $('#dialog-mask');
  const confirmBtn = $('#dialog-confirm');
  const cancelBtn = $('#dialog-cancel');
  
  confirmBtn.addEventListener('click', () => {
    container.innerHTML = '';
    if (onConfirm) onConfirm();
  });
  
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      container.innerHTML = '';
      if (onCancel) onCancel();
    });
  }
  
  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      container.innerHTML = '';
      if (onCancel) onCancel();
    }
  });
}

function navigateTo(page, data = null) {
  state.currentPage = page;
  if (data) {
    Object.assign(state, data);
  }
  render();
}

// ==================== 页面渲染 ====================

function render() {
  const container = $('#main-container');
  
  switch (state.currentPage) {
    case 'userList':
      container.innerHTML = renderUserList();
      bindUserListEvents();
      break;
    case 'userDetail':
      container.innerHTML = renderUserDetail();
      bindUserDetailEvents();
      break;
    case 'userGoods':
      container.innerHTML = renderUserGoods();
      bindUserGoodsEvents();
      break;
    case 'soldGoods':
      container.innerHTML = renderSoldGoods();
      bindSoldGoodsEvents();
      break;
    case 'settlement':
      container.innerHTML = renderSettlement();
      bindSettlementEvents();
      break;
    case 'settledList':
      container.innerHTML = renderSettledList();
      bindSettledListEvents();
      break;
    case 'settledDetail':
      container.innerHTML = renderSettledDetail();
      bindSettledDetailEvents();
      break;
    default:
      container.innerHTML = renderUserList();
  }
}

// ==================== 用户列表页面 ====================

function renderUserList() {
  const filteredUsers = state.users.filter(user => {
    const matchKeyword = !state.searchKeyword || 
      user.nickname.includes(state.searchKeyword) || 
      user.account.includes(state.searchKeyword);
    const matchRole = state.roleFilter === 'all' || user.role === state.roleFilter;
    return matchKeyword && matchRole;
  });

  const userListHTML = filteredUsers.map(user => `
    <article class="card user-card" data-user-id="${user.id}">
      <div class="avatar">${user.avatar}</div>
      <div class="user-info">
        <div class="user-name">${user.nickname}</div>
        <div class="user-meta">
          账号 ${user.account} · ${user.role === 'consignor' ? '寄售用户' : '普通用户'}<br>
          ${user.role === 'consignor' 
            ? (user.canConsign ? '寄售权限已开启' : '寄售权限已停用')
            : '暂未开启寄售'}
        </div>
      </div>
      ${user.role === 'consignor' 
        ? (user.canConsign 
          ? `<div class="rate-pill">${user.rate}%</div>`
          : `<div class="status-pill off">停用</div>`)
        : `<div class="role-pill normal">普通</div>`
      }
    </article>
  `).join('');

  const emptyState = `
    <div class="card empty-state">
      <div>
        <div class="empty-mark">空</div>
        <div class="empty-title">${state.searchKeyword ? '未找到匹配结果' : '暂无用户'}</div>
        <div class="empty-sub">${state.searchKeyword ? '换个昵称或账号再试试' : '还没有用户注册'}</div>
        ${state.searchKeyword ? '<button class="button small empty-action" id="clear-search">清空搜索</button>' : ''}
      </div>
    </div>
  `;

  return `
    <div class="page page-with-nav">
      <div class="status-bar">
        <span>9:41</span>
      </div>
      
      <div class="page-header">
        <div>
          <div class="page-title">用户管理</div>
        </div>
      </div>
      
      <div class="page-content">
        <div class="search-bar">
          <div class="search-input-wrap">
            <input type="text" class="search-input" id="search-input" 
              placeholder="搜索用户昵称 / 账号" value="${state.searchKeyword}">
            ${state.searchKeyword ? '<span class="search-clear" id="search-clear">✕</span>' : ''}
          </div>
          <div class="search-btn" id="search-btn">⌕</div>
        </div>
        
        <div class="filter-bar">
          <span class="filter-item ${state.roleFilter !== 'all' ? 'active' : ''}" id="role-filter">
            用户角色 ${state.roleFilter === 'all' ? '▼' : '●'}
          </span>
          <span class="filter-item">注册时间 ▼</span>
        </div>
        
        ${state.roleFilter !== 'all' ? `
          <div class="card filter-panel">
            <div class="filter-options">
              <div class="filter-option ${state.roleFilter === 'all' ? 'active' : ''}" data-role="all">全部用户</div>
              <div class="filter-option ${state.roleFilter === 'consignor' ? 'active' : ''}" data-role="consignor">寄售用户</div>
              <div class="filter-option ${state.roleFilter === 'normal' ? 'active' : ''}" data-role="normal">普通用户</div>
            </div>
          </div>
        ` : ''}
        
        <div class="user-list">
          ${filteredUsers.length > 0 ? userListHTML : emptyState}
        </div>
      </div>
      
      <div class="bottom-nav">
        <div class="nav-item">
          <div class="nav-icon">▥</div>
          <div>统计</div>
        </div>
        <div class="nav-item">
          <div class="nav-icon">◇</div>
          <div>商品</div>
        </div>
        <div class="nav-item active">
          <div class="nav-icon">◉</div>
          <div>用户</div>
        </div>
        <div class="nav-item">
          <div class="nav-icon">⚙</div>
          <div>设置</div>
        </div>
      </div>
    </div>
  `;
}

function bindUserListEvents() {
  // 搜索输入
  const searchInput = $('#search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchKeyword = e.target.value;
      render();
    });
  }
  
  // 清除搜索
  const searchClear = $('#search-clear');
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      state.searchKeyword = '';
      render();
    });
  }
  
  // 清空搜索按钮
  const clearSearchBtn = $('#clear-search');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      state.searchKeyword = '';
      render();
    });
  }
  
  // 搜索按钮
  const searchBtn = $('#search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      // 搜索已实时进行，这里可以添加额外逻辑
    });
  }
  
  // 角色筛选
  const roleFilter = $('#role-filter');
  if (roleFilter) {
    roleFilter.addEventListener('click', () => {
      if (state.roleFilter === 'all') {
        state.roleFilter = 'consignor';
      } else {
        state.roleFilter = 'all';
      }
      render();
    });
  }
  
  // 筛选选项
  $$('.filter-option').forEach(option => {
    option.addEventListener('click', () => {
      state.roleFilter = option.dataset.role;
      render();
    });
  });
  
  // 用户卡片点击
  $$('.user-card').forEach(card => {
    card.addEventListener('click', () => {
      const userId = parseInt(card.dataset.userId);
      const user = state.users.find(u => u.id === userId);
      if (user) {
        state.currentUser = user;
        state.editingUser = false;
        state.editingField = null;
        state.tempUserData = {};
        navigateTo('userDetail');
      }
    });
  });
}

// ==================== 用户详情页面 ====================

function renderUserDetail() {
  const user = state.currentUser;
  if (!user) return navigateTo('userList');
  
  const isEditing = state.editingUser;
  const editingField = state.editingField; // 当前编辑的字段
  
  return `
    <div class="page">
      <div class="status-bar">
        <span>9:41</span>
      </div>
      
      <div class="page-header">
        <div class="page-header-left">
          <div class="back-btn" id="back-btn">‹</div>
          <div>
            <div class="page-title">用户详情</div>
          </div>
        </div>
        ${isEditing ? `
          <div class="edit-actions">
            <div class="tiny-btn" id="cancel-edit">取消</div>
            <div class="tiny-btn primary" id="save-edit">保存</div>
          </div>
        ` : ''}
      </div>
      
      <div class="page-content">
        <!-- Header区：头像 + 昵称 + 账号 -->
        <div class="card hero-user">
          <div class="avatar large">${user.avatar}</div>
          <div class="hero-info">
            <div class="hero-name-line">
              <div class="hero-name">${user.nickname}</div>
              ${user.role === 'consignor' ? `<span class="role-pill">寄售</span>` : ''}
              ${!user.canConsign && user.role === 'consignor' ? '<span class="status-pill off">已停用寄售</span>' : ''}
            </div>
            <div class="hero-account">账号 ${user.account}</div>
          </div>
        </div>
        
        <!-- 统计区：寄售商品、已出售、已结算 -->
        <div class="stats">
          <div class="card stat-card" data-stat="goods">
            <div class="stat-num">${user.goodsCount}</div>
            <div class="stat-label">寄售商品</div>
          </div>
          <div class="card stat-card" data-stat="sold">
            <div class="stat-num">${user.soldCount}</div>
            <div class="stat-label">已出售</div>
          </div>
          <div class="card stat-card" data-stat="settled">
            <div class="stat-num">${user.settledCount}</div>
            <div class="stat-label">已结算</div>
          </div>
        </div>
        
        <!-- 信息区：可编辑字段 -->
        <div class="card info-card">
          <div class="mini-title">用户信息</div>
          
          <!-- 昵称 -->
          ${editingField === 'nickname' ? renderFieldEdit('nickname', '昵称', user.nickname, state.tempUserData.nicknameError) : `
            <div class="info-line editable" data-field="nickname">
              <span>昵称 <span class="edit-icon">✎</span></span>
              <strong>${user.nickname}</strong>
            </div>
          `}
          
          <!-- 联系方式 -->
          ${editingField === 'contact' ? renderFieldEdit('contact', '联系方式', user.contact || '', state.tempUserData.contactError) : `
            <div class="info-line editable" data-field="contact">
              <span>联系方式 <span class="edit-icon">✎</span></span>
              <strong>${user.contact || '-'}</strong>
            </div>
          `}
          
          <!-- 抽成比例（仅寄售用户） -->
          ${user.role === 'consignor' ? (
            editingField === 'rate' ? renderFieldEdit('rate', '抽成', user.rate, state.tempUserData.rateError, true) : `
              <div class="info-line editable" data-field="rate">
                <span>抽成 <span class="edit-icon">✎</span></span>
                <strong>${user.rate}%</strong>
              </div>
            `
          ) : ''}
          
          <!-- 账号（只读） -->
          <div class="info-line readonly">
            <span>账号</span>
            <strong>${user.account}</strong>
          </div>
        </div>
        
        <!-- 寄售权限开关（仅寄售用户） -->
        ${user.role === 'consignor' ? `
          <div class="card info-card">
            <div class="mini-title">寄售权限</div>
            <div class="switch-row">
              <div class="switch-label">
                <div class="switch-title">允许提交寄售</div>
                <div class="switch-hint">关闭后，已上架商品会自动下架</div>
              </div>
              <div class="switch ${user.canConsign ? 'on' : ''}" id="consign-switch"></div>
            </div>
          </div>
        ` : ''}
        
        <!-- 重置密码按钮 -->
        <button class="button ghost" id="reset-password">重置密码</button>
      </div>
    </div>
  `;
}

// 渲染单个字段的编辑态
function renderFieldEdit(fieldName, fieldLabel, fieldValue, errorMsg, isRate = false) {
  const temp = state.tempUserData;
  const currentValue = temp[fieldName] !== undefined ? temp[fieldName] : fieldValue;
  
  return `
    <div class="info-line editing">
      <span>${fieldLabel}</span>
      <div class="field-edit-wrap ${errorMsg ? 'error' : ''}">
        <input type="${isRate ? 'number' : 'text'}" 
          class="field-edit-input" 
          id="edit-${fieldName}" 
          value="${currentValue}" 
          placeholder="${isRate ? '0-100' : '请输入'}"
          ${isRate ? 'min="0" max="100"' : ''}>
        ${isRate ? '<span class="field-suffix">%</span>' : ''}
      </div>
    </div>
    ${errorMsg ? `<div class="field-error">${errorMsg}</div>` : ''}
  `;
}

function bindUserDetailEvents() {
  // 返回按钮
  $('#back-btn').addEventListener('click', () => {
    if (state.editingUser) {
      // 编辑态返回，先取消编辑
      state.editingUser = false;
      state.editingField = null;
      state.tempUserData = {};
      render();
    } else {
      navigateTo('userList');
    }
  });
  
  const user = state.currentUser;
  
  // 统计卡片点击
  $$('.stat-card').forEach(card => {
    card.addEventListener('click', () => {
      const stat = card.dataset.stat;
      if (stat === 'goods') {
        navigateTo('userGoods');
      } else if (stat === 'sold') {
        navigateTo('soldGoods');
      } else if (stat === 'settled') {
        navigateTo('settledList');
      }
    });
  });
  
  // 点击可编辑字段进入编辑态
  $$('.info-line.editable').forEach(line => {
    line.addEventListener('click', () => {
      const field = line.dataset.field;
      state.editingUser = true;
      state.editingField = field;
      state.tempUserData = {};
      render();
      
      // 自动聚焦输入框
      setTimeout(() => {
        const input = $('#edit-' + field);
        if (input) input.focus();
      }, 50);
    });
  });
  
  // 取消编辑
  const cancelEdit = $('#cancel-edit');
  if (cancelEdit) {
    cancelEdit.addEventListener('click', () => {
      state.editingUser = false;
      state.editingField = null;
      state.tempUserData = {};
      render();
    });
  }
  
  // 保存编辑
  const saveEdit = $('#save-edit');
  if (saveEdit) {
    saveEdit.addEventListener('click', () => {
      saveFieldEdit();
    });
  }
  
  // 输入监听
  const nicknameInput = $('#edit-nickname');
  if (nicknameInput) {
    nicknameInput.addEventListener('input', (e) => {
      state.tempUserData.nickname = e.target.value;
      state.tempUserData.nicknameError = '';
    });
  }
  
  const contactInput = $('#edit-contact');
  if (contactInput) {
    contactInput.addEventListener('input', (e) => {
      state.tempUserData.contact = e.target.value;
      state.tempUserData.contactError = '';
    });
  }
  
  const rateInput = $('#edit-rate');
  if (rateInput) {
    rateInput.addEventListener('input', (e) => {
      state.tempUserData.rate = e.target.value;
      state.tempUserData.rateError = '';
    });
  }
  
  // 寄售权限开关
  const consignSwitch = $('#consign-switch');
  if (consignSwitch) {
    consignSwitch.addEventListener('click', () => {
      toggleConsignPermission();
    });
  }
  
  // 重置密码
  $('#reset-password').addEventListener('click', () => {
    showDialog({
      title: '重置密码',
      text: '确认将该用户密码重置为 123456 吗？',
      confirmText: '确认重置',
      cancelText: '取消',
      onConfirm: () => {
        setTimeout(() => {
          showToast('重置密码成功');
        }, 300);
      }
    });
  });
}

// 保存字段编辑
function saveFieldEdit() {
  const user = state.currentUser;
  const field = state.editingField;
  const temp = state.tempUserData;
  
  if (!field) return;
  
  // 根据字段类型校验
  let hasError = false;
  
  if (field === 'nickname') {
    const nickname = temp.nickname !== undefined ? temp.nickname : user.nickname;
    if (!nickname || nickname.trim() === '') {
      temp.nicknameError = '请填写用户昵称';
      hasError = true;
    } else if (nickname.length > 20) {
      temp.nicknameError = '昵称字数不能超过 20 个';
      hasError = true;
    }
  } else if (field === 'contact') {
    const contact = temp.contact !== undefined ? temp.contact : user.contact;
    if (!contact || contact.trim() === '') {
      temp.contactError = '请填写联系方式';
      hasError = true;
    } else if (contact.length > 50) {
      temp.contactError = '联系方式字数不能超过 50 个';
      hasError = true;
    }
  } else if (field === 'rate' && user.role === 'consignor') {
    const rate = temp.rate !== undefined ? temp.rate : user.rate;
    if (rate === '' || rate === null || rate === undefined) {
      temp.rateError = '请填写抽成比例';
      hasError = true;
    } else {
      const rateNum = parseInt(rate);
      if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
        temp.rateError = '请填写正确的抽成比例';
        hasError = true;
      }
    }
  }
  
  if (hasError) {
    render();
    return;
  }
  
  // 抽成修改二次确认
  if (field === 'rate' && user.role === 'consignor') {
    const newRate = parseInt(temp.rate !== undefined ? temp.rate : user.rate);
    if (newRate !== user.rate) {
      showDialog({
        title: '修改抽成',
        text: '修改抽成后，仅影响未售出和未结算商品，确认修改吗？',
        confirmText: '确认修改',
        cancelText: '取消',
        onConfirm: () => {
          doSaveFieldEdit();
        }
      });
      return;
    }
  }
  
  doSaveFieldEdit();
}

function doSaveFieldEdit() {
  const user = state.currentUser;
  const field = state.editingField;
  const temp = state.tempUserData;
  
  // 更新用户数据
  if (field === 'nickname') {
    user.nickname = temp.nickname !== undefined ? temp.nickname : user.nickname;
    user.avatar = user.nickname.charAt(0);
  } else if (field === 'contact') {
    user.contact = temp.contact !== undefined ? temp.contact : user.contact;
  } else if (field === 'rate' && user.role === 'consignor') {
    user.rate = parseInt(temp.rate !== undefined ? temp.rate : user.rate);
  }
  
  // 清除编辑状态
  state.editingUser = false;
  state.editingField = null;
  state.tempUserData = {};
  
  showToast('保存成功');
  render();
}

function toggleConsignPermission() {
  const user = state.currentUser;
  const newState = !user.canConsign;
  
  if (!newState) {
    // 关闭权限
    const onSaleCount = state.goods.filter(g => g.userId === user.id && g.status === 'on_sale').length;
    showDialog({
      title: '关闭寄售权限？',
      text: `关闭后，该用户已上架商品将全部自动下架，且无法在用户端提交新的寄售。是否关闭？`,
      confirmText: '确认关闭',
      cancelText: '取消',
      onConfirm: () => {
        user.canConsign = false;
        // 自动下架已上架商品
        state.goods.forEach(g => {
          if (g.userId === user.id && g.status === 'on_sale') {
            g.status = 'off_sale';
          }
        });
        if (onSaleCount > 0) {
          showToast(`已关闭寄售权限，${onSaleCount} 件已上架商品已自动下架`);
        } else {
          showToast('已关闭寄售权限');
        }
        render();
      }
    });
  } else {
    // 开启权限
    showDialog({
      title: '开启寄售权限？',
      text: '确认开启该用户的寄售权限吗？已下架商品不会自动重新上架。',
      confirmText: '确认开启',
      cancelText: '取消',
      onConfirm: () => {
        user.canConsign = true;
        showToast('已开启寄售权限');
        render();
      }
    });
  }
}

// ==================== 用户商品列表 ====================

function renderUserGoods() {
  const user = state.currentUser;
  if (!user) return navigateTo('userList');
  
  const userGoods = state.goods.filter(g => g.userId === user.id);
  
  const goodsListHTML = userGoods.map(goods => `
    <article class="card goods-card" data-goods-id="${goods.id}">
      <div class="goods-media">
        <div class="thumb">${goods.name.charAt(0)}</div>
        <span class="quality-tag">无暇</span>
      </div>
      <div class="goods-info">
        <div class="goods-header">
          <div class="goods-title">${goods.name}</div>
          <span class="status-pill ${goods.status === 'off_sale' ? 'off' : ''}">${getStatusText(goods.status)}</span>
        </div>
        <div class="goods-meta">IP：${goods.ip}</div>
        <div class="goods-meta">数量 ${goods.quantity}</div>
        <div class="goods-meta">类型：${goods.type}</div>
        <div class="goods-footer">
          <div class="price">¥${goods.price}</div>
          <div class="extra-num">333</div>
        </div>
      </div>
    </article>
  `).join('');

  return `
    <div class="page">
      <div class="status-bar">
        <span>9:41</span>
      </div>
      
      <div class="page-header">
        <div class="page-header-left">
          <div class="back-btn" id="back-btn">‹</div>
          <div>
            <div class="page-title">${user.nickname}</div>
            <div class="page-subtitle">全部寄售商品 · ${userGoods.length} 件</div>
          </div>
        </div>
      </div>
      
      <div class="page-content">
        <div class="filter-bar">
          <span class="filter-item">所有状态 ▼</span>
          <span class="filter-item">类型 ▼</span>
          <span class="filter-item">时间 ▼</span>
        </div>
        
        <div class="goods-list">
          ${userGoods.length > 0 ? goodsListHTML : renderEmptyState('暂无商品')}
        </div>
      </div>
    </div>
  `;
}

function bindUserGoodsEvents() {
  $('#back-btn').addEventListener('click', () => {
    navigateTo('userDetail');
  });
  
  $$('.goods-card').forEach(card => {
    card.addEventListener('click', () => {
      showToast('进入商品详情');
    });
  });
}

function getStatusText(status) {
  const map = {
    'on_sale': '已上架',
    'off_sale': '已下架',
    'sold': '已售出',
    'settled': '已结算'
  };
  return map[status] || status;
}

function renderEmptyState(text) {
  return `
    <div class="card empty-state">
      <div>
        <div class="empty-mark">空</div>
        <div class="empty-title">${text}</div>
      </div>
    </div>
  `;
}

// ==================== 待结算商品列表 ====================

function renderSoldGoods() {
  const user = state.currentUser;
  if (!user) return navigateTo('userList');
  
  const soldGoods = state.goods.filter(g => g.userId === user.id && g.status === 'sold');
  const totalPrice = soldGoods.reduce((sum, g) => sum + g.price * g.soldQuantity, 0);
  
  const goodsListHTML = soldGoods.map(goods => {
    const isSelected = state.selectedGoods.includes(goods.id);
    return `
      <article class="card goods-card selectable" data-goods-id="${goods.id}">
        <div class="thumb">${goods.name.charAt(0)}</div>
        <div class="goods-info">
          <div class="goods-title">${goods.name}</div>
          <div class="goods-meta">售出数量 ${goods.soldQuantity} · 售出抽成 ${goods.soldRate}%</div>
          <div class="goods-bottom">
            <div class="price">¥${goods.price * goods.soldQuantity}</div>
          </div>
        </div>
        <div class="select-dot ${isSelected ? '' : 'unselected'}" data-goods-id="${goods.id}">
          ${isSelected ? '✓' : ''}
        </div>
      </article>
    `;
  }).join('');

  const selectedCount = state.selectedGoods.length;
  const selectedTotal = soldGoods
    .filter(g => state.selectedGoods.includes(g.id))
    .reduce((sum, g) => sum + g.price * g.soldQuantity, 0);

  return `
    <div class="page page-with-bottom-bar">
      <div class="status-bar">
        <span>9:41</span>
      </div>
      
      <div class="page-header">
        <div class="page-header-left">
          <div class="back-btn" id="back-btn">‹</div>
          <div>
            <div class="page-title">待结算商品</div>
            <div class="page-subtitle">${user.nickname} · 已售出 ${soldGoods.length} 件</div>
          </div>
        </div>
      </div>
      
      <div class="page-content">
        <div class="select-all-bar">
          <div style="display: flex; align-items: center;">
            <div class="checkbox ${selectedCount === soldGoods.length && soldGoods.length > 0 ? '' : 'unchecked'}" id="select-all">
              ${selectedCount === soldGoods.length && soldGoods.length > 0 ? '✓' : ''}
            </div>
            全选
          </div>
          <span>已选 ${selectedCount} 件</span>
        </div>
        
        <div class="goods-list">
          ${soldGoods.length > 0 ? goodsListHTML : renderEmptyState('暂无待结算商品')}
        </div>
      </div>
      
      <div class="bottom-bar two-actions">
        <button class="button secondary small" id="change-status">修改商品状态</button>
        <button class="button small" id="go-settlement">结算</button>
      </div>
    </div>
  `;
}

function bindSoldGoodsEvents() {
  $('#back-btn').addEventListener('click', () => {
    state.selectedGoods = [];
    navigateTo('userDetail');
  });
  
  // 选择商品
  $$('.select-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const goodsId = parseInt(dot.dataset.goodsId);
      const index = state.selectedGoods.indexOf(goodsId);
      if (index > -1) {
        state.selectedGoods.splice(index, 1);
      } else {
        state.selectedGoods.push(goodsId);
      }
      render();
    });
  });
  
  // 全选
  const selectAll = $('#select-all');
  if (selectAll) {
    selectAll.addEventListener('click', () => {
      const user = state.currentUser;
      const soldGoods = state.goods.filter(g => g.userId === user.id && g.status === 'sold');
      if (state.selectedGoods.length === soldGoods.length) {
        state.selectedGoods = [];
      } else {
        state.selectedGoods = soldGoods.map(g => g.id);
      }
      render();
    });
  }
  
  // 修改状态
  $('#change-status').addEventListener('click', () => {
    if (state.selectedGoods.length === 0) {
      showToast('请先选择商品');
      return;
    }
    showToast('状态修改成功');
  });
  
  // 结算
  $('#go-settlement').addEventListener('click', () => {
    if (state.selectedGoods.length === 0) {
      showToast('请至少选择一件商品进行结算');
      return;
    }
    navigateTo('settlement');
  });
}

// ==================== 结算页面 ====================

function renderSettlement() {
  const user = state.currentUser;
  if (!user) return navigateTo('userList');
  
  const selectedGoods = state.goods.filter(g => state.selectedGoods.includes(g.id));
  const goodsCount = selectedGoods.length;
  
  const totalAmount = selectedGoods.reduce((sum, g) => sum + g.price * g.soldQuantity, 0);
  const commission = selectedGoods.reduce((sum, g) => sum + g.price * g.soldQuantity * g.soldRate / 100, 0);
  const payable = totalAmount - commission;

  const goodsListHTML = selectedGoods.map(goods => `
    <article class="card goods-card">
      <div class="thumb">${goods.name.charAt(0)}</div>
      <div class="goods-info">
        <div class="goods-title">${goods.name}</div>
        <div class="goods-meta">¥${goods.price} × ${goods.soldQuantity} · 抽成 ${goods.soldRate}%</div>
      </div>
    </article>
  `).join('');

  return `
    <div class="page page-with-bottom-bar">
      <div class="status-bar">
        <span>9:41</span>
      </div>
      
      <div class="page-header">
        <div class="page-header-left">
          <div class="back-btn" id="back-btn">‹</div>
          <div>
            <div class="page-title">结算</div>
            <div class="page-subtitle">${user.nickname} · 本次 ${goodsCount} 件商品</div>
          </div>
        </div>
      </div>
      
      <div class="page-content">
        <div class="card hero-user">
          <div class="avatar">${user.avatar}</div>
          <div>
            <div class="hero-name">${user.nickname}</div>
            <div class="user-meta">抽成按售出时锁定比例计算</div>
          </div>
        </div>
        
        <div class="settle-goods-list">
          ${goodsListHTML}
        </div>
        
        <div class="card settle-summary">
          <div class="mini-title">金额汇总</div>
          <div class="money-row"><span>商品总额</span><strong>${formatMoney(totalAmount)}</strong></div>
          <div class="money-row"><span>平台抽成</span><strong>${formatMoney(commission)}</strong></div>
          <div class="money-row payable highlight"><span>应付寄售用户</span><strong>${formatMoney(payable)}</strong></div>
        </div>
        
        <div class="card info-card">
          <div class="form-row">
            <span class="form-label">商品实际收入</span>
            <div class="form-input" id="actual-income-input">
              <input type="number" id="actual-income" placeholder="请输入" min="0" step="0.01">
              <span class="hint">仅平台统计用</span>
            </div>
          </div>
        </div>
        
        <div class="card info-card">
          <div class="mini-title">结算凭证</div>
          <div class="upload-grid" id="voucher-grid">
            <div class="upload-tile" id="add-voucher">+</div>
          </div>
        </div>
      </div>
      
      <div class="bottom-bar">
        <div class="bottom-info">
          应付 ${formatMoney(payable)}
          <span>共 ${goodsCount} 件商品</span>
        </div>
        <button class="button" id="submit-settlement">提交结算</button>
      </div>
    </div>
  `;
}

function bindSettlementEvents() {
  $('#back-btn').addEventListener('click', () => {
    navigateTo('soldGoods');
  });
  
  // 凭证上传（模拟）
  const addVoucher = $('#add-voucher');
  if (addVoucher) {
    addVoucher.addEventListener('click', () => {
      const grid = $('#voucher-grid');
      const tiles = grid.querySelectorAll('.upload-tile');
      if (tiles.length >= 4) {
        showToast('最多上传 3 张凭证');
        return;
      }
      
      // 模拟添加凭证
      const voucherId = 'voucher_' + Date.now();
      const newTile = document.createElement('div');
      newTile.className = 'upload-tile filled';
      newTile.innerHTML = `
        凭
        <div class="upload-remove" data-voucher="${voucherId}">✕</div>
      `;
      grid.insertBefore(newTile, addVoucher);
      
      // 绑定删除
      newTile.querySelector('.upload-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        newTile.remove();
      });
    });
  }
  
  // 提交结算
  $('#submit-settlement').addEventListener('click', () => {
    const actualIncome = $('#actual-income').value;
    const vouchers = $$('.upload-tile.filled');
    
    if (!actualIncome || parseFloat(actualIncome) <= 0) {
      showToast('请填写商品实际收入');
      return;
    }
    
    if (vouchers.length === 0) {
      showToast('请上传结算凭证');
      return;
    }
    
    showDialog({
      title: '确认提交结算',
      text: '确认提交本次结算吗？提交后所选商品状态变为已结算且不可撤销。',
      confirmText: '确认提交',
      cancelText: '取消',
      onConfirm: () => {
        // 执行结算
        const user = state.currentUser;
        const selectedGoods = state.goods.filter(g => state.selectedGoods.includes(g.id));
        
        // 更新商品状态
        selectedGoods.forEach(g => {
          g.status = 'settled';
        });
        
        // 更新用户统计
        user.soldCount -= selectedGoods.length;
        user.settledCount += selectedGoods.length;
        
        // 创建结算记录
        const totalAmount = selectedGoods.reduce((sum, g) => sum + g.price * g.soldQuantity, 0);
        const commission = selectedGoods.reduce((sum, g) => sum + g.price * g.soldQuantity * g.soldRate / 100, 0);
        
        const newSettlement = {
          id: 'S' + Date.now(),
          userId: user.id,
          date: new Date().toISOString().split('T')[0],
          goodsCount: selectedGoods.length,
          totalAmount: totalAmount,
          commission: commission,
          actualIncome: parseFloat(actualIncome),
          payable: totalAmount - commission,
          goods: [...state.selectedGoods],
          vouchers: []
        };
        
        state.settlements.unshift(newSettlement);
        state.selectedGoods = [];
        
        showToast('结算成功');
        navigateTo('settledList');
      }
    });
  });
}

// ==================== 已结算记录列表 ====================

function renderSettledList() {
  const user = state.currentUser;
  if (!user) return navigateTo('userList');
  
  const userSettlements = state.settlements.filter(s => s.userId === user.id);
  
  const recordListHTML = userSettlements.map(record => `
    <article class="card record-card" data-record-id="${record.id}">
      <div class="record-top">
        <span>${record.date}</span>
        <strong>共 ${record.goodsCount} 件</strong>
      </div>
      <div class="record-meta">
        商品总额 ${formatMoney(record.totalAmount)} · 抽成 ${formatMoney(record.commission)} · 应付 ${formatMoney(record.payable)}
      </div>
    </article>
  `).join('');

  return `
    <div class="page">
      <div class="status-bar">
        <span>9:41</span>
      </div>
      
      <div class="page-header">
        <div class="page-header-left">
          <div class="back-btn" id="back-btn">‹</div>
          <div>
            <div class="page-title">已结算记录</div>
            <div class="page-subtitle">${user.nickname} · 历史结算</div>
          </div>
        </div>
      </div>
      
      <div class="page-content">
        <div class="record-list">
          ${userSettlements.length > 0 ? recordListHTML : renderEmptyState('暂无结算记录')}
        </div>
      </div>
    </div>
  `;
}

function bindSettledListEvents() {
  $('#back-btn').addEventListener('click', () => {
    navigateTo('userDetail');
  });
  
  $$('.record-card').forEach(card => {
    card.addEventListener('click', () => {
      const recordId = card.dataset.recordId;
      const record = state.settlements.find(s => s.id === recordId);
      if (record) {
        state.currentSettlement = record;
        navigateTo('settledDetail');
      }
    });
  });
}

// ==================== 结算记录详情 ====================

function renderSettledDetail() {
  const user = state.currentUser;
  const record = state.currentSettlement;
  if (!user || !record) return navigateTo('userList');
  
  const recordGoods = state.goods.filter(g => record.goods.includes(g.id));
  
  const goodsListHTML = recordGoods.map(goods => `
    <article class="card goods-card">
      <div class="thumb">${goods.name.charAt(0)}</div>
      <div class="goods-info">
        <div class="goods-title">${goods.name}</div>
        <div class="goods-meta">¥${goods.price} × ${goods.soldQuantity} · 已结算</div>
      </div>
    </article>
  `).join('');

  return `
    <div class="page">
      <div class="status-bar">
        <span>9:41</span>
      </div>
      
      <div class="page-header">
        <div class="page-header-left">
          <div class="back-btn" id="back-btn">‹</div>
          <div>
            <div class="page-title">结算详情</div>
            <div class="page-subtitle">${record.date} · 共 ${record.goodsCount} 件商品</div>
          </div>
        </div>
      </div>
      
      <div class="page-content">
        <div class="settle-goods-list">
          ${goodsListHTML}
        </div>
        
        <div class="card settle-summary">
          <div class="mini-title">金额汇总</div>
          <div class="money-row"><span>商品总额</span><strong>${formatMoney(record.totalAmount)}</strong></div>
          <div class="money-row"><span>抽成金额</span><strong>${formatMoney(record.commission)}</strong></div>
          <div class="money-row"><span>商品实际收入</span><strong>${formatMoney(record.actualIncome)}</strong></div>
          <div class="money-row payable highlight"><span>已付寄售用户</span><strong>${formatMoney(record.payable)}</strong></div>
        </div>
        
        ${record.vouchers && record.vouchers.length > 0 ? `
          <div class="card info-card">
            <div class="mini-title">结算凭证</div>
            <div class="voucher-preview">
              ${record.vouchers.map((v, i) => `
                <div class="voucher-item">${i + 1}</div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function bindSettledDetailEvents() {
  $('#back-btn').addEventListener('click', () => {
    navigateTo('settledList');
  });
  
  $$('.goods-card').forEach(card => {
    card.addEventListener('click', () => {
      showToast('查看商品详情（已结算）');
    });
  });
}

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
  render();
});
