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
      console.log("【调试】GET请求参数:", JSON.stringify(argv));
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
    console.log("【调试】调用WPS AirScript API，URL:", air_url);
    console.log("【调试】请求头:", { "Content-Type": "application/json", "AirScript-Token": process.env.AIRSCRIPT_TOKEN });
    console.log("【调试】请求体:", JSON.stringify(airScriptPayload));
    
    let result = null;
    
    try {
      const res = await fetch(air_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "AirScript-Token": process.env.AIRSCRIPT_TOKEN,
        },
        body: JSON.stringify(airScriptPayload),
      });

      const resBody = await res.json();
      console.log("【调试】WPS AirScript API响应:", JSON.stringify(resBody));
      
      // 检查API是否返回错误
      if (resBody.errno && resBody.errno !== 0) {
        console.error("【调试】WPS AirScript API调用失败:", resBody.msg);
        // 直接抛出错误，不使用模拟数据
        throw new Error(`WPS AirScript API Error: ${resBody.msg} (${resBody.errno})`);
      } else if (resBody.error && resBody.error !== "") {
        console.error("【调试】WPS AirScript API调用失败:", resBody.error);
        throw new Error(`WPS AirScript API Error: ${resBody.error}`);
      } else if (resBody.status !== "finished") {
        console.error("【调试】WPS AirScript API调用未完成:", resBody.status);
        throw new Error(`WPS AirScript API Status: ${resBody.status}`);
      }
      
      // 解析WPS AirScript API返回的数据结构
      let rawResult = resBody?.data?.result ?? null;
      
      // 处理不同的数据结构
      if (rawResult && rawResult.records) {
        // 新数据结构：{records: {records: [...]}}
        if (rawResult.records.records) {
          result = { data: [{ records: rawResult.records.records }] };
        } else {
          // 旧数据结构：{records: [...]}
          result = { data: [{ records: rawResult.records }] };
        }
      } else {
        // 其他数据结构
        result = rawResult;
      }
      
      // 解析 WPS 可能返回的字符串化 JSON
      if (typeof result === "string") {
        try { 
          console.log("【调试】解析字符串化JSON:", result);
          result = JSON.parse(result); 
        } catch (e) {
          console.error("解析 AirScript 结果失败", e);
          throw new Error("解析 AirScript 结果失败: " + e.message);
        }
      }
      
      // 如果没有返回数据，抛出错误
      if (!result) {
        throw new Error("WPS AirScript API未返回数据");
      }
      
      console.log("【调试】解析后的数据结构:", JSON.stringify(result));
      
      
    } catch (error) {
      console.error("【调试】WPS AirScript API调用出错:", error);
      // 直接抛出错误，不使用模拟数据
      throw error;
    }
    
    console.log("【调试】最终处理结果:", JSON.stringify(result));

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

// 辅助函数：提供模拟数据
function getMockData(argv) {
    const { method, b } = argv || {};
    
    // 根据b参数判断返回什么数据
    if (method === 'read') {
        if (b === 1) {
            // 返回技师数据
            return {
                success: true,
                data: [
                    { records: [
                        { id: '1', fields: { '姓名': '张三', '部门': '美容科' } },
                        { id: '2', fields: { '姓名': '李四', '部门': '皮肤科' } },
                        { id: '3', fields: { '姓名': '王五', '部门': '美容科' } },
                        { id: '4', fields: { '姓名': '赵六', '部门': '皮肤科' } },
                        { id: '5', fields: { '姓名': '孙七', '部门': '美容科' } }
                    ] }
                ]
            };
        } else {
            // 返回预约数据
            return {
                success: true,
                data: [
                    { records: [
                        { id: '1001', fields: { '客户姓名': '客户A', '预约时间': '14:00', '时长': '60', '技师&护士': '张三', '选择技师': ['1'], '服务项目': ['面部清洁'] } },
                        { id: '1002', fields: { '客户姓名': '客户B', '预约时间': '15:30', '时长': '90', '技师&护士': '李四', '选择技师': ['2'], '服务项目': ['光子嫩肤'] } }
                    ] }
                ]
            };
        }
    }
    
    // 默认返回空数据
    return { success: true, data: [] };
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