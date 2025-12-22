// 文件路径: src/wps.js

const WPS = {
  // 1. 检查手机号 (保持不变)
  async checkUserExists(phone, env) {
    try {
      const records = await this._fetchUserRecords(env); 
      if (!records) return false;

      const targetPhone = String(phone).trim();
      const user = records.find(item => {
        const fields = item.fields || item; 
        const dbPhone = String(fields['电话'] || fields['phonenum'] || '').trim();
        return dbPhone === targetPhone;
      });

      if (user) {
        console.log(`✅ [WPS] 验证通过: ${targetPhone}`);
        return true;
      }
      return false;
    } catch (e) {
      console.error("❌ [WPS] 代码异常:", e);
      return false;
    }
  },

  // 2. 获取用户信息 (保持不变)
  async getUserInfo(phone, env) {
    try {
      const records = await this._fetchUserRecords(env);
      if (!records) return null;

      const targetPhone = String(phone).trim();
      const user = records.find(item => {
        const fields = item.fields || item;
        const dbPhone = String(fields['电话'] || fields['phonenum'] || '').trim();
        return dbPhone === targetPhone;
      });

      if (user) {
        const fields = user.fields || user;
        const nameRaw = fields['姓名'] || fields['name'] || fields['username'];
        const name = nameRaw ? String(nameRaw).trim() : null;
        const roleRaw = fields['身份'] || fields['role'] || fields['职位'];
        const role = roleRaw ? String(roleRaw).trim() : '员工';
        return { name, role };
      }
      return null;
    } catch (e) {
      console.error("❌ [WPS] 获取用户信息异常:", e);
      return null;
    }
  },

  // ============================================
  // [修改] 获取应用列表 (传递身份 val)
  // ============================================
 async getAppMenu(role) {
    try {
      const apiUrl = process.env.APP_AIR_URL;
      
      const payload = {
        Context: { 
          argv: { 
            action: "get_menu",
            val: role || "员工" 
          }, 
          sheet_name: "应用" 
        }
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "AirScript-Token": process.env.AIRSCRIPT_TOKEN,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`[WPS] 获取菜单失败: ${response.status}`);
        return [];
      }

      const body = await response.json();
      
      let records = [];

      // === 核心修复点: 适配正确的返回结构 ===
      if (body.data && body.data.result && body.data.result.data) {
          // 适配日志中的结构: body.data.result.data
          records = body.data.result.data;
      } else if (body.records) {
          records = body.records;
      } else if (body.data && body.data.result && body.data.result.records) {
          records = Array.isArray(body.data.result.records) 
            ? body.data.result.records 
            : body.data.result.records.records;
      } else if (body.result && body.result.records) {
          records = body.result.records;
      }

      return records || [];
    } catch (e) {
      console.error("❌ [WPS] getAppMenu 异常:", e);
      return [];
    }
  },

  // === 内部辅助方法 (保持不变) ===
  async _fetchUserRecords(env) {
    try {
      const apiUrl = process.env.USER_AIR_URL;
      const payload = {
        Context: { 
          argv: { action: "get_users" }, 
          sheet_name: "名单" 
        }
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "AirScript-Token": process.env.AIRSCRIPT_TOKEN,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) return null;

      const body = await response.json();
      let records = [];
      
      if (body.records) {
        records = body.records;
      } else if (body.data && body.data.result && body.data.result.records) {
        if (Array.isArray(body.data.result.records)) {
          records = body.data.result.records;
        } else if (body.data.result.records.records) {
          records = body.data.result.records.records;
        }
      } else if (body.result && body.result.records) {
        records = body.result.records;
      }

      if (!records || records.length === 0) return null;
      return records;
    } catch (e) {
      console.error("❌ [WPS] _fetchUserRecords 异常:", e);
      return null;
    }
  }
};

module.exports = { WPS };