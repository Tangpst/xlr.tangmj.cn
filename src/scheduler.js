// 文件路径: src/scheduler.js

async function handleSchedulerRequest(request, parsedBody) {
  // 1. 检查环境变量
  const air_url = process.env.SCHEDULER_AIR_URL;
  if (!air_url) {
    console.error("严重错误: 缺少环境变量 SCHEDULER_AIR_URL");
    return createJsonParams({ success: false, error: "Configuration Error" }, 500);
  }

  const url = new URL(request.url);

  // === CORS 预检 ===
  if (request.method === "OPTIONS") {
    return createJsonParams(null, 204);
  }

  try {
    let airScriptPayload = {};

    // [GET] 读取模式
    if (request.method === "GET") {
      const searchParams = url.searchParams;
      let argv = { 
        method: 'read', 
        date: searchParams.get('date'), 
        b: parseInt(searchParams.get('b') || 0) 
      };
      airScriptPayload = { Context: { argv } };
    } 
    // [POST] 写入模式
    else if (request.method === "POST") {
      const body = parsedBody || {}; 
      let argv = { method: 'write', data: body };
      airScriptPayload = { Context: { argv } };
    } else {
      return createJsonParams({ error: "Method not allowed" }, 405);
    }

    // === 请求 WPS ===
    // 注意：确保你的 FC 环境是 Node 18+ (原生支持 fetch)，否则需配置 node-fetch
    const res = await fetch(air_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AirScript-Token": process.env.AIRSCRIPT_TOKEN,
      },
      body: JSON.stringify(airScriptPayload),
    });

    const resBody = await res.json();
    let result = resBody?.data?.result ?? null;
    
    if (typeof result === "string") {
      try { result = JSON.parse(result); } catch (e) {
        console.error("解析 AirScript 结果失败", e);
      }
    }

    // === 数据清洗 (关键修复) ===
    if (request.method === "GET" && result) {
       // 获取实际的数据容器
       let rawData = result.data || result; 
       
       // 情况 A: 嵌套结构 { records: [...] }
       if (Array.isArray(rawData) && rawData.length > 0 && rawData[0].records) {
           rawData[0].records = filterGhostRecords(rawData[0].records);
       } 
       // 情况 B: 普通数组结构 [...] (最容易出错的地方)
       else if (Array.isArray(rawData)) {
           // 修复：直接替换 rawData，不要给数组加 .data 属性
           const filtered = filterGhostRecords(rawData);
           if (result.data) {
               result.data = filtered;
           } else {
               result = filtered; // 将 result 引用指向过滤后的新数组
           }
       }
    }

    // === 格式化返回 ===
    let responseData;
    // 如果 result 是数组，说明它是数据本身，需要包装一下
    if (Array.isArray(result)) {
        responseData = { success: true, data: result, message: "请求成功" };
    } 
    // 如果 result 已经是标准对象接口
    else if (result && typeof result === 'object' && result.success !== undefined) {
        responseData = result;
    } 
    // 兜底
    else {
        responseData = { success: true, data: result, message: "请求成功" };
    }
    
    return createJsonParams(responseData, 200);

  } catch (err) {
    console.error("FC Handler Error:", err);
    return createJsonParams({ success: false, error: "Internal Error: " + err.message }, 500);
  }
}

// 辅助函数：过滤掉没有姓名的空记录
function filterGhostRecords(records) {
    if (!Array.isArray(records)) return records;
    return records.filter(item => {
        const f = item.fields || item;
        return (f['客户姓名'] && String(f['客户姓名']).trim()) || 
               (f['姓名'] && String(f['姓名']).trim());
    });
}

// 【关键修改】：适配 Node.js 环境的响应构造器
// 不要使用 new Response()，而是返回 index.js 能识别的对象
function createJsonParams(data, status) {
  const bodyStr = data ? JSON.stringify(data) : null;
  
  return {
    status: status,
    // 使用 Map 以兼容 index.js 中的 .forEach 遍历
    headers: new Map([
        ['Content-Type', 'application/json; charset=utf-8'],
        ['Access-Control-Allow-Origin', '*'],
        ['Access-Control-Allow-Methods', 'GET, POST, OPTIONS'],
        ['Access-Control-Allow-Headers', 'Content-Type, Authorization']
    ]),
    // 模拟 Response.text() 方法
    text: async () => bodyStr
  };
}

module.exports = { handleSchedulerRequest };
