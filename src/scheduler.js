// 文件路径: src/scheduler.js

// 【修改点】：增加 parsedBody 参数
export async function handleSchedulerRequest(request, parsedBody) {
  const url = new URL(request.url);
  const air_url = process.env.SCHEDULER_AIR_URL; 

  // === 1. CORS 预检 ===
  if (request.method === "OPTIONS") {
    return createJsonParams(null, 204);
  }

  try {
    let airScriptPayload = {};

    // [GET] 读取模式
    if (request.method === "GET") {
      const searchParams = url.searchParams;
      // 构造 AirScript 读取参数
      let argv = { 
        method: 'read', 
        date: searchParams.get('date'), 
        b: parseInt(searchParams.get('b') || 0) 
      };
      airScriptPayload = { Context: { argv } };
    } 
    
    // [POST] 写入模式
    else if (request.method === "POST") {
      // 【修改点】：直接使用传入的 parsedBody，绝对不要再调用 request.json()
      const body = parsedBody || {}; 

      let argv = { 
        method: 'write', 
        data: body 
      };
      airScriptPayload = { Context: { argv } };
    } 
    
    else {
      return createJsonParams({ error: "Method not allowed" }, 405);
    }

    // === 3. 请求 WPS AirScript ===
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
    
    // 解析 WPS 可能返回的字符串化 JSON
    if (typeof result === "string") {
      try { result = JSON.parse(result); } catch (e) {
        console.error("解析 AirScript 结果失败", e);
      }
    }

    // === 4. 数据清洗 (解决“未知客户” Ghost Card 问题) ===
    // 如果是读取操作 (GET)，我们在返回给前端前，先帮它洗一遍数据
    if (request.method === "GET" && result) {
       // 处理 result 结构可能是 {data: [...]} 或 {success:true, data:[...]}
       let rawData = result.data || result; 
       
       // 兼容 WPS 的 records 嵌套结构: {data: [{records: [...]}]}
       if (Array.isArray(rawData) && rawData.length > 0 && rawData[0].records) {
           rawData = rawData[0].records;
           // 重新封装回去，保持结构一致
           result.data[0].records = filterGhostRecords(rawData);
       } 
       // 兼容普通数组结构
       else if (Array.isArray(rawData)) {
           result.data = filterGhostRecords(rawData);
       }
    }

    // === 5. 格式化返回 ===
    let responseData;
    if (result && typeof result === 'object' && result.success !== undefined) {
        responseData = result;
    } else {
        responseData = { success: true, data: result, message: "请求成功" };
    }
    
    return createJsonParams(responseData, 200);

  } catch (err) {
    console.error("Worker Error:", err);
    return createJsonParams({ success: false, error: "Worker 内部错误: " + err.message }, 500);
  }
}

// 辅助函数：过滤掉没有姓名的空记录
function filterGhostRecords(records) {
    if (!Array.isArray(records)) return records;
    return records.filter(item => {
        const f = item.fields || item;
        // 只有当 '客户姓名' 或 '姓名' 存在且不为空时，才保留
        // 这样可以彻底在服务器端干掉“未知客户”
        return (f['客户姓名'] && String(f['客户姓名']).trim()) || 
               (f['姓名'] && String(f['姓名']).trim());
    });
}

function createJsonParams(data, status) {
  return new Response(data ? JSON.stringify(data) : null, {
    status: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": '*',
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    },
  });
}