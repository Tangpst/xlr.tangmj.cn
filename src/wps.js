// 文件路径: src/wps.js

const WPS = {
  // 1. 检查手机号是否存在
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

      console.log(`❌ [WPS] 未找到用户: ${targetPhone}`);
      return false;

    } catch (e) {
      console.error("❌ [WPS] 代码异常:", e);
      return false;
    }
  },

  // 2. 获取用户信息 (姓名 + 身份)
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
        
        // 1. 获取姓名
        const nameRaw = fields['姓名'] || fields['name'] || fields['username'];
        const name = nameRaw ? String(nameRaw).trim() : null;

        // 2. 获取身份 (优先匹配 '身份', 'role', '职位')
        const roleRaw = fields['身份'] || fields['role'] || fields['职位'];
        const role = roleRaw ? String(roleRaw).trim() : '员工'; // 默认为 '员工'

        return { name, role };
      }

      return null;
    } catch (e) {
      console.error("❌ [WPS] 获取用户信息异常:", e);
      return null;
    }
  },

  // 3. 兼容旧方法 (可选)
  async getUserName(phone, env) {
    const info = await this.getUserInfo(phone, env);
    return info ? info.name : null;
  },

  // ============================================
  // 4. [修改] 获取应用列表 (传递身份 val)
  // ============================================
  async getAppMenu(role) {
    try {
      const apiUrl = process.env.APP_AIR_URL;
      
      // 这里的 val 参数会传递给 WPS AirScript 脚本
      const payload = {
        Context: { 
          argv: { 
            action: "get_menu",
            val: role || "员工"  // 传入当前身份
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

      // === 核心修复点: 适配多种返回结构 ===
      // 尤其是适配 body.data.result.data 这种深层结构
      if (body.data && body.data.result && body.data.result.data) {
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

  // === 内部辅助方法：统一拉取用户名单 ===
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

      if (!response.ok) {
        const errText = await response.text();
        console.error(`❌ [WPS] API 请求失败 (Status ${response.status}): ${errText}`);
        return null;
      }

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

      if (!records || records.length === 0) {
        // console.warn("⚠️ [WPS] 未读取到任何记录"); // 可选开启，避免日志太多
        return null;
      }
      
      return records;
    } catch (e) {
      console.error("❌ [WPS] _fetchUserRecords 异常:", e);
      return null;
    }
  }
};

module.exports = { WPS };