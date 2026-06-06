/**
 * 密码工具模块 - 纯明文处理
 */

function normalizePasswordInput(password) {
  return String(password == null ? "" : password);
}

function hashPassword(password) {
  return normalizePasswordInput(password);
}

function verifyPassword(plainPassword, storedPassword) {
  const plain = normalizePasswordInput(plainPassword);
  const stored = normalizePasswordInput(storedPassword);
  return !!stored && stored === plain;
}

module.exports = {
  hashPassword,
  verifyPassword
};
