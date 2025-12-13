// 文件路径: src/wps.js

export const WPS = {
  // 1. 检查手机号是否存在 (原逻辑保持不变)
  async checkUserExists(phone, env) {
    try {
      const records = await this._fetchUserRecords(env); // 复用内部获取逻辑
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

  // 2. [新增] 获取用户姓名 (供 Auth 登录时调用)
  async getUserName(phone, env) {
    try {
      // 复用下方的获取数据逻辑，避免代码重复
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
        // 尝试匹配常见的中英文姓名字段
        // 根据你的表格列名，这里优先找 '姓名'，其次找 'name'
        const name = fields['姓名'] || fields['name'] || fields['username'];
        return name ? String(name).trim() : null;
      }

      return null;
    } catch (e) {
      console.error("❌ [WPS] 获取姓名异常:", e);
      return null;
    }
  },

  // === 内部辅助方法：统一拉取数据逻辑 ===
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
      
      // 兼容多种返回结构
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
        console.warn("⚠️ [WPS] 未读取到任何记录，请检查 AirScript 脚本逻辑或 SheetId。");
        return null;
      }
      
      return records;
    } catch (e) {
      console.error("❌ [WPS] _fetchUserRecords 异常:", e);
      return null;
    }
  }
};