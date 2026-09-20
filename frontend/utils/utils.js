import { parse, stringify } from 'qs';
import { API_CODE } from './constants';

export function getPageQuery() {
  return parse(window.location.href.split('?')[1]);
}

export function setQueryString(query) {
  const search = stringify(query);
  if (search.length) {
    return `?${search}`;
  }
  return '';
}

export function isAntDesignPro() {
  if (ANT_DESIGN_PRO_ONLY_DO_NOT_USE_IN_YOUR_PRODUCTION === 'site') {
    return true;
  }
  return window.location.hostname === 'preview.pro.ant.design';
}

export const isDev = process.env.NODE_ENV === 'development' || process.env.REACT_APP_ENV === 'dev';

// ==================== API 响应处理 ====================

/**
 * 检查 API 响应是否成功
 * @param {Object} response - API 响应对象
 * @returns {boolean}
 */
export function isApiSuccess(response) {
  if (!response) return false;
  return response.code === API_CODE.SUCCESS || response.code === API_CODE.SUCCESS_200;
}

/**
 * 获取 API 错误信息
 * @param {Object} response - API 响应对象
 * @param {string} defaultMessage - 默认错误信息
 * @returns {string}
 */
export function getApiError(response, defaultMessage = '操作失败') {
  if (!response) return defaultMessage;
  return response.message || response.msg || defaultMessage;
}

// ==================== 格式化函数 ====================

/**
 * 格式化金额
 * @param {number} amount - 金额
 * @param {number} decimals - 小数位数
 * @returns {string}
 */
export function formatAmount(amount, decimals = 2) {
  if (amount === null || amount === undefined) return '-';
  return `¥${Number(amount).toFixed(decimals)}`;
}

/**
 * 格式化日期时间
 * @param {string|Date} date - 日期
 * @param {string} format - 格式
 * @returns {string}
 */
export function formatDateTime(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}
export function formatOtherDateTime(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  d.setTime(d.getTime() - 8 * 60 * 60 * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}
/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// ==================== 数据处理 ====================

/**
 * 防抖函数
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function}
 */
export function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function}
 */
export function throttle(func, wait = 300) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), wait);
    }
  };
}

/**
 * 深拷贝对象
 * @param {any} obj - 要拷贝的对象
 * @returns {any}
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (obj instanceof Array) return obj.map((item) => deepClone(item));
  if (obj instanceof Object) {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
}

/**
 * 下载文件
 * @param {string} url - 文件 URL
 * @param {string} filename - 文件名
 */
export function downloadFile(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==================== 语音播报服务 ====================

/**
 * 语音播报服务类
 * 用于操作过程中的语音反馈
 */
class VoiceServiceClass {
  constructor() {
    this.synth = window.speechSynthesis;
    this.enabled = true;
    this.voices = [];
    this.currentVoice = null;

    // 加载可用语音列表
    this.loadVoices();

    // 监听语音列表变化（某些浏览器异步加载）
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => {
        this.loadVoices();
      };
    }
  }

  /**
   * 加载可用语音列表
   */
  loadVoices() {
    this.voices = this.synth.getVoices();
    // 优先选择中文语音
    this.currentVoice = this.voices.find((voice) => voice.lang.startsWith('zh')) || this.voices[0];
  }

  /**
   * 播报文本
   * @param {string} text - 要播报的文本
   * @param {Object} options - 播报选项
   */
  speak(text, options = {}) {
    if (!this.enabled || !this.synth) return;

    // 取消当前正在播报的内容
    this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = this.currentVoice;
    utterance.rate = options.rate || 1; // 语速
    utterance.pitch = options.pitch || 1; // 音调
    utterance.volume = options.volume || 1; // 音量

    this.synth.speak(utterance);
  }

  /**
   * 播报成功消息
   */
  speakSuccess(message = '操作成功') {
    this.speak(message);
  }

  /**
   * 播报失败消息
   */
  speakError(message = '操作失败') {
    this.speak(message, { rate: 0.9 });
  }

  /**
   * 播报入库成功
   */
  speakReceiveSuccess() {
    this.speak('入库成功');
  }

  /**
   * 播报入库失败
   */
  speakReceiveError() {
    this.speak('入库失败', { rate: 0.9 });
  }

  speakPartialReceive(remaining) {
    this.speak(`还有${remaining}个未入库，请继续扫码`, { rate: 1.0 });
  }

  /**
   * 停止播报
   */
  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
  }

  /**
   * 启用/禁用语音
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  /**
   * 检查是否启用
   */
  isEnabled() {
    return this.enabled;
  }
}

// 导出单例
export const voiceService = new VoiceServiceClass();
