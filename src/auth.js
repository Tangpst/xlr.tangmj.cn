// src/auth.js (修复中文乱码 + 身份字段版)
const { WPS } = require('./wps.js'); 

// === 替代 KV 的内存存储 ===
const MemoryKV = new Map();

const Auth = {
  async checkPhoneInWps(phone) {
    return await WPS.checkUserExists(phone); 
  },

  // [新增] 获取用户完整信息（对接 WPS.getUserInfo）
  async getUserInfo(phone) {
    try {
      const info = await WPS.getUserInfo(phone);
      return info; 
    } catch (e) {
      console.error("[Auth] 获取用户信息失败:", e);
      return null;
    }
  },

  // 旧方法保留兼容
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
        const response = await fetch(process.env.SMS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phoneNumber: phone,
              code: code,
              templateCode: process.env.SMS_TEMPLATE_CODE
            })
        });
        const res = await response.json();
        return res.success === true || res.code === 200 || res.code === 'OK'; 
    } catch (e) {
        console.error("[Auth] 发送短信网络异常:", e);
        return false;
    }
  },

  async generateAndStoreCode(phone) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `sms:${phone}`;
    MemoryKV.set(key, { code, expire: Date.now() + 300 * 1000 });
    return code;
  },

  async verifyLogin(phone, inputCode) {
    const key = `sms:${phone}`;
    const record = MemoryKV.get(key);
    
    if (!record) return false;
    if (Date.now() > record.expire) {
        MemoryKV.delete(key);
        return false;
    }
    if (record.code !== inputCode) return false;
    
    MemoryKV.delete(key); 
    return true;
  }
};

const Jwt = {
    async sign(payload, secret) {
        const header = { alg: 'HS256', typ: 'JWT' };
        const now = Math.floor(Date.now() / 1000);
        // Token 有效期 7 天
        const data = { ...payload, iat: now, exp: now + (86400 * 7) };
        
        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(data));
        
        const tokenBase = `${encodedHeader}.${encodedPayload}`;
        const signature = await signHmacSha256(tokenBase, secret);
        
        return `${tokenBase}.${signature}`;
    },

    async verify(token, secret) {
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        
        const [encodedHeader, encodedPayload, signature] = parts;
        const tokenBase = `${encodedHeader}.${encodedPayload}`;
        
        const isValid = await verifyHmacSha256(signature, tokenBase, secret);
        if (!isValid) return null;
        
        try {
            // 使用支持中文的解码函数
            const payloadJson = base64UrlDecodeToString(encodedPayload);
            const payload = JSON.parse(payloadJson);
            
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) return null;
            
            return payload;
        } catch (e) { 
            console.error("JWT Parse Error:", e);
            return null; 
        }
    }
};

// ==========================================
// 加密辅助函数
// ==========================================

async function importKey(secret, usage) {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]
  );
}

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

function base64UrlDecodeToString(str) {
  const bytes = base64UrlDecodeToArrayBuffer(str);
  const dec = new TextDecoder();
  return dec.decode(bytes);
}

function arrayBufferToBase64Url(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecodeToArrayBuffer(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  
  const binaryString = atob(str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer; 
};

module.exports = { Auth, Jwt };