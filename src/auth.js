// src/auth.js (修改版)
import { WPS } from './wps.js'; 

// === 替代 KV 的内存存储 ===
const MemoryKV = new Map();

export const Auth = {
  // 1. 去掉 env 参数
  async checkPhoneInWps(phone) {
    return await WPS.checkUserExists(phone); // WPS 内部也改用 process.env
  },

  async getUserName(phone) {
    try {
      const name = await WPS.getUserName(phone);
      return name; 
    } catch (e) {
      console.error("[Auth] 获取姓名失败:", e);
      return null;
    }
  },

  async sendSmsViaWorker(phone, code) {
    try {
      // 修改：使用 process.env
      const response = await fetch(process.env.SMS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phone,
          code: code,
          templateCode: process.env.SMS_TEMPLATE_CODE
        })
      });
      // ... (后续代码不变)
      const res = await response.json();
      return res.success === true || res.code === 200 || res.code === 'OK'; 
    } catch (e) {
      console.error("[Auth] 发送短信网络异常:", e);
      return false;
    }
  },

  // 4. 修改 KV 存储逻辑
  async generateAndStoreCode(phone) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    // 存入内存，设置 5 分钟过期
    const key = `sms:${phone}`;
    MemoryKV.set(key, { code, expire: Date.now() + 300 * 1000 });
    
    // 清理过期数据的简单逻辑 (可选)
    return code;
  },

  // 5. 修改验证逻辑
  async verifyLogin(phone, inputCode) {
    const key = `sms:${phone}`;
    const record = MemoryKV.get(key);
    
    if (!record) return false;
    if (Date.now() > record.expire) {
        MemoryKV.delete(key);
        return false;
    }
    if (record.code !== inputCode) return false;
    
    MemoryKV.delete(key); // 验证成功后删除
    return true;
  }
};

// === JWT 工具 (保持不变，除了 verify 里的 console 可能需要改) ===
export const Jwt = {
    // 代码基本可以保持不变，Node 20 原生支持 crypto.subtle
    // 只要调用时传入的 secret 是字符串即可
    async sign(payload, secret) { /* ...原代码... */ 
        // 确保把原来文件里的代码完整拷过来
        // 原文件里的代码在 Node 20 下是可以运行的
        // ...
        const header = { alg: 'HS256', typ: 'JWT' };
        const now = Math.floor(Date.now() / 1000);
        const data = { ...payload, iat: now, exp: now + (86400 * 7) };
        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(data));
        const tokenBase = `${encodedHeader}.${encodedPayload}`;
        const signature = await signHmacSha256(tokenBase, secret);
        return `${tokenBase}.${signature}`;
    },
    async verify(token, secret) { /* ...原代码... */ 
        // ...
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [encodedHeader, encodedPayload, signature] = parts;
        const tokenBase = `${encodedHeader}.${encodedPayload}`;
        const isValid = await verifyHmacSha256(signature, tokenBase, secret);
        if (!isValid) return null;
        try {
            const payload = JSON.parse(base64UrlDecode(encodedPayload));
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) return null;
            return payload;
        } catch (e) { return null; }
    }
};

// ... (底部的加密辅助函数必须保留，它们在 Node 20 可用) ...
// 请确保把原 auth.js 底部的 helper functions (importKey, signHmacSha256 等) 全部复制过来
async function importKey(secret, usage) {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]
  );
}
// ... 其他 helper 函数
async function signHmacSha256(data, secret) {
  const key = await importKey(secret, "sign");
  const enc = new TextEncoder();
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return arrayBufferToBase64Url(signature);
}

async function verifyHmacSha256(signature, data, secret) {
  const key = await importKey(secret, "verify");
  const enc = new TextEncoder();
  const signatureBytes = base64UrlDecodeToArrayBuffer(signature);
  return await crypto.subtle.verify("HMAC", key, signatureBytes, enc.encode(data));
}

function base64UrlEncode(str) {
  const enc = new TextEncoder();
  return arrayBufferToBase64Url(enc.encode(str));
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  return atob(str);
}

function arrayBufferToBase64Url(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToArrayBuffer(str) {
  const binaryString = base64UrlDecode(str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}