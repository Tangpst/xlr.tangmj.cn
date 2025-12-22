// src/wages.js
// 用于获取工资数据 (对应 WPS 脚本逻辑)

const fetchWagesData = async (phone, month) => {
    try {
        const apiUrl = process.env.WAGES_AIR_URL;
        if (!apiUrl) {
            console.error("❌ [Wages] 环境变量 WAGES_AIR_URL 未定义");
            return { error: "配置错误" };
        }

        // 构造 WPS 需要的参数 (phone 和 month)
        // 注意：month 的格式需要和 WPS 数据库中的格式一致 (例如 "2025/11" 或 "2025-11")
        const payload = {
            Context: {
                argv: { 
                    phone: String(phone).trim(),
                    month: String(month).trim()
                }
            }
        };

        console.log(`🔍 [Wages] 查询工资: 手机=${phone}, 月份=${month}`);

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "AirScript-Token": process.env.AIRSCRIPT_TOKEN || "", 
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.error(`❌ [Wages] 请求失败: ${response.status}`);
            return [];
        }

        const body = await response.json();
        let records = [];

        // === 数据结构适配 (兼容多种返回格式) ===
        if (body.data && body.data.result) {
            if (Array.isArray(body.data.result)) {
                records = body.data.result;
            } else if (body.data.result.data && Array.isArray(body.data.result.data)) {
                records = body.data.result.data;
            } else {
                records = body.data.result;
            }
        } else if (body.result) {
            records = body.result;
        } else if (Array.isArray(body)) {
            records = body;
        }

        return Array.isArray(records) ? records : [];

    } catch (e) {
        console.error("❌ [Wages] 代码异常:", e);
        return [];
    }
};

module.exports = { fetchWagesData };