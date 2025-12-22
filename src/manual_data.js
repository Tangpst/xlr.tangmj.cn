// src/manual_data.js

const fetchManualData = async (phone) => {
    try {
        const apiUrl = process.env.SERVER_MANUAL_URL;
        // 1. 打印日志，确认参数
        console.log(`🔍 [ManualData] 正在请求 WPS，手机号: "${phone}"`);

        if (!apiUrl) {
            console.error("❌ [ManualData] 环境变量 SERVER_MANUAL_URL 未定义");
            return [];
        }

        const payload = {
            Context: {
                argv: { 
                    phone: String(phone).trim() 
                }
            }
        };

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "AirScript-Token": process.env.AIRSCRIPT_TOKEN || "", 
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.error(`❌ [ManualData] 请求失败: ${response.status}`);
            return [];
        }

        const body = await response.json();
        
        // 2. 打印 WPS 返回的原始结构，方便排查
        console.log("📥 [ManualData] WPS 原始响应:", JSON.stringify(body));

        let records = [];

        // === 数据结构适配 ===
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
        console.error("❌ [ManualData] 代码异常:", e);
        return [];
    }
};

module.exports = { fetchManualData };