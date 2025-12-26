# WPS脚本 - 微信OpenID处理

## 概述

这个脚本需要添加到你的WPS多维表格的AirScript中，用于处理微信openid的查询和绑定。

**注意**：脚本使用表ID（10）直接操作表，不需要通过表名。

## 脚本代码

将以下代码添加到你的WPS多维表格的AirScript脚本中：

```javascript
// ============================================
// WPS AirScript - 微信OpenID处理脚本（使用Record API）
// ============================================

// 获取传入的参数
const action = Context.argv.action;

// 表ID配置（根据实际情况修改）
const SHEET_ID = 10;

// 字段名配置（根据实际情况修改）
const FIELD_PHONE = "电话";
const FIELD_OPENID = "A openid";  // 根据你的实际字段名修改

// ============================================
// 辅助函数：获取所有记录（支持分页）
// ============================================
function getAllRecords(filter) {
    let allRecords = [];
    let offset = null;
    
    while (offset !== null || allRecords.length === 0) {
        try {
            const params = {
                SheetId: SHEET_ID
            };
            
            if (offset) {
                params.Offset = offset;
            }
            
            if (filter) {
                params.Filter = filter;
            }
            
            const result = Application.Record.GetRecords(params);
            
            if (result && result.records) {
                allRecords = allRecords.concat(result.records);
            }
            
            // 检查是否还有更多数据
            offset = result && result.offset ? result.offset : null;
            
            // 如果没有offset或records为空，退出循环
            if (!offset || (result.records && result.records.length === 0)) {
                break;
            }
        } catch (e) {
            console.error("获取记录失败:", e);
            break;
        }
    }
    
    return allRecords;
}

// ============================================
// 1. 获取所有用户（原有功能，保持不变）
// ============================================
if (action === "get_users") {
    try {
        const result = Application.Record.GetRecords({ 
            SheetId: SHEET_ID 
        });
        
        // 转换为兼容格式
        const records = (result.records || []).map(record => ({
            fields: record.fields || {},
            id: record.id
        }));
        
        return { 
            records: records 
        };
    } catch (e) {
        console.error("获取用户列表失败:", e);
        return { 
            success: false, 
            error: "获取用户列表失败: " + (e.message || String(e)),
            records: [] 
        };
    }
}

// ============================================
// 2. 通过openid查找手机号
// ============================================
if (action === "get_phone_by_openid") {
    const openid = Context.argv.openid;
    
    if (!openid) {
        return { success: false, error: "缺少openid参数", phone: null };
    }
    
    try {
        // 使用过滤器查询openid匹配的记录
        const filter = {
            "mode": "AND", 
            "criteria": [{
                "field": FIELD_OPENID,  // 使用配置的字段名
                "op": "Equals",
                "values": [String(openid).trim()]
            }]
        };
        
        const allRecords = getAllRecords(filter);
        
        if (allRecords && allRecords.length > 0) {
            // 找到匹配的记录，提取第一个记录的电话字段
            const firstRecord = allRecords[0];
            const phone = firstRecord.fields && firstRecord.fields[FIELD_PHONE];
            
            if (phone) {
                return { 
                    success: true, 
                    phone: String(phone).trim() 
                };
            } else {
                return { 
                    success: false, 
                    phone: null,
                    error: "找到记录但电话字段为空" 
                };
            }
        } else {
            // 未找到匹配的记录
            return { 
                success: false, 
                phone: null 
            };
        }
    } catch (e) {
        console.error("查找手机号失败:", e);
        return { 
            success: false, 
            error: "查找手机号失败: " + (e.message || String(e)),
            phone: null 
        };
    }
}

// ============================================
// 3. 绑定openid到手机号（更新openid字段）
// ============================================
if (action === "bind_openid") {
    const openid = Context.argv.openid;
    const phone = Context.argv.phone;
    
    if (!openid || !phone) {
        return { 
            success: false, 
            error: "缺少openid或phone参数" 
        };
    }
    
    try {
        // 使用过滤器查询手机号匹配的记录
        const filter = {
            "mode": "AND", 
            "criteria": [{
                "field": FIELD_PHONE,
                "op": "Equals",
                "values": [String(phone).trim()]
            }]
        };
        
        const allRecords = getAllRecords(filter);
        
        if (!allRecords || allRecords.length === 0) {
            return { 
                success: false, 
                error: `未找到手机号为 ${phone} 的用户` 
            };
        }
        
        // 获取第一条匹配记录的ID
        const recordId = allRecords[0].id;
        
        if (!recordId) {
            return { 
                success: false, 
                error: "获取记录ID失败" 
            };
        }
        
        // 更新记录的openid字段
        const updateResult = Application.Record.UpdateRecords({
            SheetId: SHEET_ID,
            Records: [{
                id: recordId,
                fields: {
                    [FIELD_OPENID]: String(openid).trim()  // 使用配置的字段名
                }
            }]
        });
        
        // 检查更新结果
        if (updateResult && updateResult.records && updateResult.records.length > 0) {
            return { 
                success: true, 
                updated: true, 
                message: `成功绑定openid到手机号: ${phone}` 
            };
        } else {
            return { 
                success: false, 
                error: "更新记录失败，请检查字段名和权限" 
            };
        }
    } catch (e) {
        console.error("绑定openid失败:", e);
        return { 
            success: false, 
            error: "绑定openid失败: " + (e.message || String(e)) 
        };
    }
}

// 默认返回（如果没有匹配的action）
return { success: false, error: "未知的action参数: " + (action || "undefined") };
```

## 字段名配置

脚本顶部有字段名配置，请根据你的实际字段名修改：

```javascript
const FIELD_PHONE = "电话";      // 手机号字段名
const FIELD_OPENID = "A openid";  // openid字段名（根据你的实际字段名修改）
```

如果你的字段名不同，只需要修改这两个常量即可。

## 使用说明

### 1. 配置说明

脚本顶部有配置项，请根据实际情况修改：

```javascript
const SHEET_ID = 10;              // 表ID（根据你的实际表ID修改）
const FIELD_PHONE = "电话";       // 手机号字段名
const FIELD_OPENID = "A openid";  // openid字段名（根据你的实际字段名修改）
```

### 2. 添加脚本到WPS

1. 打开你的WPS多维表格
2. 进入 AirScript 编辑器
3. 将上面的代码粘贴进去
4. 确认表ID是否正确（默认为10）
5. 保存并发布

### 2. 测试脚本

可以通过以下方式测试：

#### 测试1：获取所有用户（原有功能）
```json
{
  "Context": {
    "argv": {
      "action": "get_users"
    }
  }
}
```

#### 测试2：通过openid查找手机号
```json
{
  "Context": {
    "argv": {
      "action": "get_phone_by_openid",
      "openid": "test_openid_123"
    }
  }
}
```

#### 测试3：绑定openid到手机号
```json
{
  "Context": {
    "argv": {
      "action": "bind_openid",
      "openid": "test_openid_123",
      "phone": "18668000187"
    }
  }
}
```

## 注意事项

1. **字段名匹配**：确保脚本中的字段名与你的WPS表字段名一致。如果 `A openid` 字段名有变化，需要修改脚本中的字段名匹配逻辑。

2. **权限**：确保AirScript有写入权限，否则无法更新openid字段。

3. **错误处理**：脚本包含了基本的错误处理，如果出现错误会返回相应的错误信息。

4. **数据格式**：openid和phone都会被转换为字符串并去除首尾空格，确保数据一致性。

## 调试建议

如果遇到问题，可以：

1. 检查字段名是否正确
2. 检查AirScript是否有写入权限
3. 查看WPS AirScript的执行日志
4. 在后端代码中查看控制台输出的错误信息

## 代码优化说明

### 主要改进：

1. **使用Record API**：使用 `Application.Record.GetRecords` 和 `Application.Record.UpdateRecords` API，这是WPS多维表格的标准API

2. **分页处理**：`getAllRecords` 辅助函数自动处理分页，确保获取所有匹配的记录

3. **错误处理**：所有操作都添加了 try-catch 错误处理，并返回详细的错误信息

4. **字段名配置**：在脚本顶部集中配置字段名，方便修改

5. **返回值统一**：所有操作都返回统一的 `success` 字段，便于后端判断

6. **完善逻辑**：
   - `get_phone_by_openid`: 使用过滤器精确查询，支持分页
   - `bind_openid`: 先查找记录，再更新，有完整的错误提示
   - `get_users`: 保持原有功能，返回格式兼容

### 注意事项：

1. **字段名必须准确**：确保 `FIELD_OPENID` 和 `FIELD_PHONE` 配置的字段名与你的WPS表中完全一致（区分大小写）

2. **权限检查**：确保AirScript有读取和更新记录的权限

3. **表ID确认**：确保 `SHEET_ID` 配置的是正确的表ID

4. **测试建议**：可以先测试 `get_users` 功能，确认能正常获取数据后，再测试openid相关功能

## 完整脚本使用

如果你的脚本中已有 `get_users` 功能，可以将原有的替换为上面的版本，然后添加 `get_phone_by_openid` 和 `bind_openid` 两个action的处理逻辑。

如果你的脚本还没有这些功能，直接使用上面提供的完整脚本即可。

