async function handleWpsRequest(request, requestBody) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const nameSearch = searchParams.get('name');
  // 【新增】获取 URL 中的 id 参数 (例如 /api/v1?id=1001)
  const idSearch = searchParams.get('id');
  
  let air_url = "";
  let argv = {}; 
  let payload = {};

  // --- 1. 组装参数 ---
  if (url.pathname === "/api/v1") { 
    air_url = process.env.ARTICLE_AIR_URL;
    
    // 【新增】如果请求带了 id，这就传给 WPS 脚本
    // 即使 WPS 脚本没写筛选逻辑，传过去通常也不会报错，前端拿到完整列表后再 find 也是一种兼容方案
    if (idSearch) {
        argv = { id: idSearch };
    }
    
    payload = { Context: { argv, sheet_name: "文档列表" } };
  }
  else if (url.pathname === "/api/v2") {
    air_url = process.env.TRAINING_AIR_URL;
    payload = { Context: { argv, sheet_name: "培训记录单" } };
  }
  else if (url.pathname === "/api/v3") {
    if (nameSearch) {
      air_url = process.env.SERCH_AIR_URL;
      argv = { name: nameSearch };
    } else {
      air_url = process.env.CLINIC_AIR_URL;
    }
    payload = { Context: { argv, sheet_name: "病例提交表" } };
  }
  else if (url.pathname === "/api/v4") {
    air_url = process.env.MANUAL_AIR_URL;
    
    // 关键点：确保 phonenum 被传递
    const phonenum = requestBody.phonenum;
    if (!phonenum) {
      return createJsonParams({ success: false, error: "缺少phonenum参数", data: null }, 400);
    }
    
    argv = { phonenum: phonenum };
    
    // 透传 code (用于标记 AUTO_LOGIN)
    if (requestBody.code) {
      argv.code = requestBody.code;
    }
    
    payload = { Context: { argv, sheet_name: "绩效" } };
  }
  else if (url.pathname === "/api/v5") {
    air_url = process.env.PRECAUTIONS_AIR_URL;
    // 获取 project 参数
    const projectSearch = searchParams.get('project');
    // 只有当 project 参数存在且不为空字符串时才传递
    if (projectSearch !== null && projectSearch !== '') {
      argv = { project: projectSearch };
    } else {
      // 传递空字符串表示获取所有数据
      argv = { project: '' };
    }
    payload = { Context: { argv, sheet_name: "注意事项" } };
    console.log('[WPS Routes] /api/v5 请求参数:', JSON.stringify(payload, null, 2));
  } else {
    return null; 
  }

  // --- 2. 请求 WPS ---
  try {
    const res = await fetch(air_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AirScript-Token": process.env.AIRSCRIPT_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    
    // 添加日志以便调试
    if (url.pathname === "/api/v5") {
      console.log('[WPS Routes] /api/v5 WPS 原始返回:', JSON.stringify(body, null, 2));
    }
    
    let result = body?.data?.result ?? null;

    if (typeof result === "string") {
      try { result = JSON.parse(result); } catch (e) {}
    }

    // --- 3. 结果处理 (核心修改) ---
    let responseData;
    
    if (url.pathname === "/api/v5") {
      // 特殊处理 /api/v5 - 根据实际数据结构处理
      // 检查是否有错误
      if (body.error) {
        console.error('[WPS Routes] /api/v5 WPS 脚本执行错误:', body.error);
        console.error('[WPS Routes] /api/v5 错误详情:', JSON.stringify(body.error_details, null, 2));
        return createJsonParams({
          success: false,
          error: body.error,
          error_details: body.error_details,
          message: "WPS 脚本执行失败"
        }, 500);
      }
      
      // WPS 可能返回: [{records: [...]}] 或 body.data.result = [{records: [...]}]
      let finalData = null;
      
      // 情况1: body.data.result 存在且不为 null
      if (result !== null && result !== undefined) {
        finalData = result;
      } 
      // 情况2: body.data 直接是数组
      else if (body.data && Array.isArray(body.data)) {
        finalData = body.data;
      }
      // 情况3: body 直接是数组
      else if (Array.isArray(body)) {
        finalData = body;
      }
      // 情况4: body.result 存在
      else if (body.result !== null && body.result !== undefined) {
        finalData = body.result;
      }
      
      console.log('[WPS Routes] /api/v5 提取的数据:', JSON.stringify(finalData, null, 2));
      
      responseData = {
        success: true,
        data: finalData,
        message: "请求成功"
      };
    } else if (url.pathname === "/api/v4") {
      const inputCode = requestBody && requestBody.code;

      // 如果是自动登录模式 (AUTO_LOGIN)
      if (inputCode === "AUTO_LOGIN") {
          // === 宽容模式 ===
          // 只要 WPS 有返回 result (即使是空数组)，或者 result 里面有 data
          // 我们就认为成功，因为 WPS 端已经去除了验证逻辑
          let finalData = result;
          
          // 兼容性处理：如果 WPS 还是包了一层 data
          if (result && result.data) finalData = result.data;

          responseData = {
            success: true,      // 强制标记为成功
            verify: 1,          // 强制标记为验证通过
            data: finalData,    // 直接返回数据
            message: "查询成功"
          };
      } 
      // 常规验证码模式 (保留原有逻辑，以防万一)
      else if (inputCode) {
        let isSuccess = false;
        if (result && (result.verify === 1 || result.success === true)) {
            isSuccess = true;
        }
        responseData = {
          success: isSuccess,
          data: result?.data || result,
          message: isSuccess ? "验证成功" : "验证码错误",
          verify: isSuccess ? 1 : 0
        };
      } else {
        // 发送验证码请求
        responseData = {
          success: true,
          data: result,
          message: "发送成功",
          verify: 0
        };
      }
    } else {
      // V1-V3 通用处理
      responseData = {
        success: true,
        data: (result && result.data) ? result.data : result,
        message: "请求成功"
      };
    }
    
    return createJsonParams(responseData, 200);

  } catch (err) {
    console.error("Worker Error:", err);
    return createJsonParams({ success: false, error: "调用失败", data: null }, 500);
  }
}

// 替换原来的 createJsonParams
function createJsonParams(data, status) {
  const bodyStr = data ? JSON.stringify(data) : null;
  return {
    status: status,
    // 保持和 scheduler.js 一致，使用 Map
    headers: new Map([
      ['Content-Type', 'application/json; charset=utf-8'],
      ['Access-Control-Allow-Origin', '*'],
      ['Access-Control-Allow-Methods', 'GET, POST, OPTIONS'],
      ['Access-Control-Allow-Headers', 'Content-Type, Authorization']
    ]),
    text: async () => bodyStr
  };
}
module.exports = { handleWpsRequest };