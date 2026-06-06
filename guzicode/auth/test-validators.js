// 测试验证函数 - 基于产品设计文档
// 此文件用于测试注册登录功能的验证逻辑

console.log('=== 谷圈星社 - 注册登录功能验证测试 ===\n');

// 验证函数测试
// 1. 账号验证
console.log('--- 1. 账号验证测试 ---');

function testValidateAccount(value, expectedError, description) {
  function validateAccount(value) {
    if (!value) {
      return "请输入账号";
    }
    if (value !== "admin" && !/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,12}$/.test(value)) {
      return "账号需为6-12位数字和字母组合";
    }
    return "";
  }
  
  const error = validateAccount(value);
  const passed = error === expectedError;
  console.log(`${passed ? '✅' : '❌'} ${description}`);
  if (!passed) {
    console.log(`   输入: "${value}"`);
    console.log(`   期望: "${expectedError}"`);
    console.log(`   实际: "${error}"`);
  }
  return passed;
}

let accountTests = [
  { value: '', expected: '请输入账号', desc: '账号为空时提示"请输入账号"' },
  { value: 'admin', expected: '', desc: '管理员账号"admin"验证通过' },
  { value: 'abcdef', expected: '账号需为6-12位数字和字母组合', desc: '纯字母账号报错' },
  { value: '123456', expected: '账号需为6-12位数字和字母组合', desc: '纯数字账号报错' },
  { value: 'ab12', expected: '账号需为6-12位数字和字母组合', desc: '少于6位账号报错' },
  { value: 'abcdefgh123456', expected: '账号需为6-12位数字和字母组合', desc: '超过12位账号报错' },
  { value: 'abc@123', expected: '账号需为6-12位数字和字母组合', desc: '含特殊字符账号报错' },
  { value: 'test123', expected: '', desc: '6-12位字母数字组合验证通过' },
  { value: 'User001', expected: '', desc: '包含大小写字母的账号验证通过' },
  { value: 'a1b2c3', expected: '', desc: '6位字母数字组合验证通过' },
  { value: 'abc123xyz45', expected: '', desc: '12位字母数字组合验证通过' }
];

let totalPassed = 0;
let totalTests = 0;

accountTests.forEach(test => {
  if (testValidateAccount(test.value, test.expected, test.desc)) totalPassed++;
  totalTests++;
});

// 2. 密码验证
console.log('\n--- 2. 密码验证测试 ---');

function testValidatePassword(value, expectedError, description) {
  function validatePassword(value) {
    if (!value) {
      return "请输入密码";
    }
    if (!/^[A-Za-z\d]{6,12}$/.test(value)) {
      return "密码需为6-12位数字或字母";
    }
    return "";
  }
  
  const error = validatePassword(value);
  const passed = error === expectedError;
  console.log(`${passed ? '✅' : '❌'} ${description}`);
  if (!passed) {
    console.log(`   输入: "${value}"`);
    console.log(`   期望: "${expectedError}"`);
    console.log(`   实际: "${error}"`);
  }
  return passed;
}

let passwordTests = [
  { value: '', expected: '请输入密码', desc: '密码为空时提示"请输入密码"' },
  { value: '12345', expected: '密码需为6-12位数字或字母', desc: '少于6位密码报错' },
  { value: '1234567890123', expected: '密码需为6-12位数字或字母', desc: '超过12位密码报错' },
  { value: 'abc@123', expected: '密码需为6-12位数字或字母', desc: '含特殊字符密码报错' },
  { value: 'abcdef', expected: '', desc: '纯字母密码验证通过' },
  { value: '123456', expected: '', desc: '纯数字密码验证通过' },
  { value: 'abcd1234', expected: '', desc: '字母数字组合密码验证通过' },
  { value: 'Pass123', expected: '', desc: '包含大小写字母的密码验证通过' },
  { value: 'a1b2c3d', expected: '', desc: '7位字母数字组合验证通过' },
  { value: 'abcdefgh1234', expected: '', desc: '12位字母数字组合验证通过' }
];

passwordTests.forEach(test => {
  if (testValidatePassword(test.value, test.expected, test.desc)) totalPassed++;
  totalTests++;
});

// 3. 确认密码验证
console.log('\n--- 3. 确认密码验证测试 ---');

function testValidateConfirmPassword(password, confirmPassword, expectedError, description) {
  function validateConfirmPassword(password, confirmPassword) {
    if (!confirmPassword) {
      return "请再次输入密码";
    }
    if (password !== confirmPassword) {
      return "两次输入的密码不一致";
    }
    return "";
  }
  
  const error = validateConfirmPassword(password, confirmPassword);
  const passed = error === expectedError;
  console.log(`${passed ? '✅' : '❌'} ${description}`);
  if (!passed) {
    console.log(`   密码: "${password}", 确认密码: "${confirmPassword}"`);
    console.log(`   期望: "${expectedError}"`);
    console.log(`   实际: "${error}"`);
  }
  return passed;
}

let confirmPasswordTests = [
  { password: 'test123', confirmPassword: '', expected: '请再次输入密码', desc: '确认密码为空时提示' },
  { password: 'test123', confirmPassword: 'test1234', expected: '两次输入的密码不一致', desc: '两次密码不一致时报错' },
  { password: 'test123', confirmPassword: 'test123', expected: '', desc: '两次密码一致时验证通过' },
  { password: 'Abc123', confirmPassword: 'abc123', expected: '两次输入的密码不一致', desc: '大小写不同时报错' },
  { password: '123456', confirmPassword: '123456', expected: '', desc: '纯数字密码确认验证通过' }
];

confirmPasswordTests.forEach(test => {
  if (testValidateConfirmPassword(test.password, test.confirmPassword, test.expected, test.desc)) totalPassed++;
  totalTests++;
});

// 4. 昵称验证
console.log('\n--- 4. 昵称验证测试 ---');

function testValidateNickname(value, expectedError, description) {
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
  
  const error = validateNickname(value);
  const passed = error === expectedError;
  console.log(`${passed ? '✅' : '❌'} ${description}`);
  if (!passed) {
    console.log(`   输入: "${value}"`);
    console.log(`   期望: "${expectedError}"`);
    console.log(`   实际: "${error}"`);
  }
  return passed;
}

let nicknameTests = [
  { value: '', expected: '请输入昵称', desc: '昵称为空时提示"请输入昵称"' },
  { value: '测试@昵称', expected: '昵称仅支持中文、英文或数字', desc: '含特殊字符昵称报错' },
  { value: '测试!昵称', expected: '昵称仅支持中文、英文或数字', desc: '含感叹号昵称报错' },
  { value: '一二三四五六七八九十一二三四', expected: '昵称不能超过12个字', desc: '超过12字昵称报错' },
  { value: '测试用户', expected: '', desc: '中文昵称验证通过' },
  { value: 'testuser', expected: '', desc: '英文昵称验证通过' },
  { value: '123456', expected: '', desc: '数字昵称验证通过' },
  { value: 'test用户123', expected: '', desc: '混合昵称验证通过' },
  { value: '谷圈星社用户', expected: '', desc: '6字中文昵称验证通过' },
  { value: '一二三四五六七八九十一二', expected: '', desc: '12字昵称验证通过' },
  { value: 'User123测试', expected: '', desc: '中英文数字混合验证通过' }
];

nicknameTests.forEach(test => {
  if (testValidateNickname(test.value, test.expected, test.desc)) totalPassed++;
  totalTests++;
});

// 5. 测试总结
console.log('\n--- 5. 测试总结 ---');
console.log(`总测试用例数: ${totalTests}`);
console.log(`通过: ${totalPassed}`);
console.log(`失败: ${totalTests - totalPassed}`);
console.log(`通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

if (totalPassed === totalTests) {
  console.log('\n🎉 所有测试通过！验证逻辑符合产品设计文档要求。');
} else {
  console.log('\n⚠️  部分测试失败，请检查验证逻辑。');
}

console.log('\n=== 测试结束 ===');
