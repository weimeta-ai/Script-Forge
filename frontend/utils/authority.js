const TokenKey = 'order-agent-token';
const TokenTypeKey = 'order-agent-token-type';
const AuthorityKey = 'order-agent-authority';
const UserInfoKey = 'order-agent-user-info';

export function getToken() {
  return localStorage.getItem(TokenKey);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TokenKey, token);
  } else {
    localStorage.removeItem(TokenKey);
  }
}

export function getTokenType() {
  return localStorage.getItem(TokenTypeKey) || 'Bearer';
}

export function setTokenType(type) {
  if (type) {
    localStorage.setItem(TokenTypeKey, type);
  } else {
    localStorage.removeItem(TokenTypeKey);
  }
}

export function getAuthority() {
  const authority = localStorage.getItem(AuthorityKey);
  return authority ? JSON.parse(authority) : [];
}

export function setAuthority(authority) {
  if (authority) {
    if (Array.isArray(authority)) {
      localStorage.setItem(AuthorityKey, JSON.stringify(authority));
    } else {
      localStorage.setItem(AuthorityKey, JSON.stringify([authority]));
    }
  } else {
    localStorage.removeItem(AuthorityKey);
  }
}

export function getUserInfo() {
  const userInfo = localStorage.getItem(UserInfoKey);
  return userInfo ? JSON.parse(userInfo) : null;
}

export function setUserInfo(userInfo) {
  if (userInfo) {
    localStorage.setItem(UserInfoKey, JSON.stringify(userInfo));
  } else {
    localStorage.removeItem(UserInfoKey);
  }
}

export function clearAuthority() {
  localStorage.removeItem(TokenKey);
  localStorage.removeItem(TokenTypeKey);
  localStorage.removeItem(AuthorityKey);
  localStorage.removeItem(UserInfoKey);
}

// 检查是否有某个权限
export function checkPermission(permission) {
  const authorities = getAuthority();
  if (!authorities || authorities.length === 0) {
    return false;
  }
  // admin 拥有所有权限
  if (authorities.includes('admin')) {
    return true;
  }
  return authorities.includes(permission);
}

// 检查是否有某个角色
export function checkRole(role) {
  const authorities = getAuthority();
  if (!authorities || authorities.length === 0) {
    return false;
  }
  return authorities.includes(role);
}

// 检查是否有多个权限中的任意一个
export function checkPermissions(permissions) {
  if (!permissions || permissions.length === 0) {
    return true;
  }
  const authorities = getAuthority();
  if (!authorities || authorities.length === 0) {
    return false;
  }
  if (authorities.includes('admin')) {
    return true;
  }
  return permissions.some(p => authorities.includes(p));
}

// 获取当前用户的所有权限
export function getAllPermissions() {
  const authorities = getAuthority();
  if (!authorities || authorities.length === 0) {
    return [];
  }
  if (authorities.includes('admin')) {
    // admin 拥有所有权限，返回所有可能的权限
    return ['admin', 'user', 'editor', 'viewer'];
  }
  return authorities;
}
