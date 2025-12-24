// src/history.js

/**
 * 处理历史记录查询请求
 * 对应 WPS 脚本参数: 
 * - data: [startDate, endDate]
 * - phone: 用户手机号
 */
async function handleHistoryRequest(startDate, endDate, userPhone) {
  // 1. 检查环境变量
  const air_url = process.env.HISTORY_AIR_URL; // 记得在 .env 中配置这个新的 WPS 脚本链接
  if (!air_url) {
    throw new Error("配置错误: 缺少 HISTORY_AIR_URL 环境变量");
  }

  // 2. 构造 AirScript 需要的参数结构
  // 对应脚本中的: const data = Context.argv.data 和 const phone = Context.argv.phone
  const airScriptPayload = {
    Context: {
      argv: {
        data: [startDate, endDate], // 对应脚本中的 data[0], data[1]
        phone: userPhone            // 对应脚本中的 phone
      }
    }
  };

  // 3. 请求 WPS
  try {
    const res = await fetch(air_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AirScript-Token": process.env.AIRSCRIPT_TOKEN,
      },
      body: JSON.stringify(airScriptPayload),
    });

    // 4. 处理响应
    const resBody = await res.json();
    
    // WPS 返回的数据通常包裹在 result 或 data.result 中
    let result = resBody?.data?.result ?? [];

    // 如果 AirScript 返回的是字符串类型的 JSON，需要二次解析
    if (typeof result === "string") {
        try { result = JSON.parse(result); } catch (e) {}
    }

    return { success: true, data: result };

  } catch (err) {
    console.error("History API Error:", err);
    return { success: false, error: "查询失败: " + err.message };
  }
}

module.exports = { handleHistoryRequest };