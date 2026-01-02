// src/index.js (修复版：解决 getBody is not defined 错误)
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { handleWpsRequest } = require('./wps_routes.js');
// 【修改1】同时引入 handleCancelRequest
const { handleSchedulerRequest, handleCancelRequest } = require('./scheduler.js');
const { Auth, Jwt } = require('./auth.js');
const { WPS } = require('./wps.js'); 
const { fetchManualData } = require('./manual_data.js'); 
const { handleHistoryRequest } = require('./history.js');


const app = express();

app.use(express.json());
app.use(cookieParser());

// === 辅助函数 ===
async function sendWorkerResponse(res, workerResponsePromise) {
    try {
        const workerResp = await workerResponsePromise;
        res.status(workerResp.status);
        workerResp.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });
        const text = await workerResp.text();
        res.send(text);
    } catch (e) {
        console.error('Adapter Error:', e);
        res.status(500).send(e.message);
    }
}

// ============================================================
// API 接口
// ============================================================

app.post('/api/auth/send', async (req, res) => {
    try {
        const { phone } = req.body;
        const isAllowed = await Auth.checkPhoneInWps(phone);
        if (!isAllowed) return res.status(403).send('非内部人员或手机号错误');
        const code = await Auth.generateAndStoreCode(phone);
        const success = await Auth.sendSmsViaWorker(phone, code);
        if (success) res.send('ok');
        else res.status(500).send('短信发送失败');
    } catch (e) { res.status(400).send('格式错误'); }
});

// 登录接口
app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, code } = req.body;
        const isValid = await Auth.verifyLogin(phone, code);
        if (!isValid) return res.status(400).send('验证码错误');

        const userInfo = await Auth.getUserInfo(phone) || {};
        const name = userInfo.name || '员工';
        const role = userInfo.role || '员工';

        const token = await Jwt.sign({ phone, name, role }, process.env.JWT_SECRET);

        res.cookie('auth_token', token, { httpOnly: true, secure: false, maxAge: 604800000 });
        
        res.json({ success: true, name, role });
    } catch (e) { 
        console.error(e);
        res.status(400).send('登录失败'); 
    }
});

// 微信登录接口
app.post('/api/auth/wechat-login', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).send('缺少code参数');

        // 1. 通过code获取openid
        const openid = await Auth.getWechatOpenId(code);
        if (!openid) return res.status(400).send('获取openid失败');

        // 2. 通过openid查找绑定的用户
        const phone = await Auth.getPhoneByOpenId(openid);
        if (!phone) {
            // 如果未绑定，返回需要绑定手机号
            return res.status(200).json({ 
                success: false, 
                needBind: true, 
                openid: openid 
            });
        }

        // 3. 验证用户是否还在WPS中存在
        const userExists = await Auth.checkPhoneInWps(phone);
        if (!userExists) {
            // 用户已被删除，清除缓存
            Auth.clearOpenIdCache(openid, phone);
            return res.status(403).json({ 
                success: false, 
                error: '用户不存在或已被删除' 
            });
        }

        // 4. 获取用户信息并生成token
        const userInfo = await Auth.getUserInfo(phone) || {};
        if (!userInfo || !userInfo.name) {
            // 无法获取用户信息，可能已被删除
            Auth.clearOpenIdCache(openid, phone);
            return res.status(403).json({ 
                success: false, 
                error: '用户信息获取失败' 
            });
        }
        
        const name = userInfo.name || '员工';
        const role = userInfo.role || '员工';

        const token = await Jwt.sign({ phone, name, role, openid }, process.env.JWT_SECRET);
        res.cookie('auth_token', token, { httpOnly: true, secure: false, maxAge: 604800000 });
        
        res.json({ success: true, name, role });
    } catch (e) { 
        console.error('[Wechat Login Error]', e);
        res.status(400).send('微信登录失败'); 
    }
});

// 微信绑定手机号接口
app.post('/api/auth/wechat-bind', async (req, res) => {
    try {
        const { openid, phone, code } = req.body;
        if (!openid || !phone || !code) {
            return res.status(400).send('缺少必要参数');
        }

        // 1. 验证手机号和验证码
        const isValid = await Auth.verifyLogin(phone, code);
        if (!isValid) return res.status(400).send('验证码错误');

        // 2. 检查手机号是否已授权
        const isAllowed = await Auth.checkPhoneInWps(phone);
        if (!isAllowed) return res.status(403).send('非内部人员或手机号错误');

        // 3. 绑定openid和手机号
        await Auth.bindOpenIdToPhone(openid, phone);

        // 4. 获取用户信息并生成token
        const userInfo = await Auth.getUserInfo(phone) || {};
        const name = userInfo.name || '员工';
        const role = userInfo.role || '员工';

        const token = await Jwt.sign({ phone, name, role, openid }, process.env.JWT_SECRET);
        res.cookie('auth_token', token, { httpOnly: true, secure: false, maxAge: 604800000 });
        
        res.json({ success: true, name, role });
    } catch (e) { 
        console.error('[Wechat Bind Error]', e);
        res.status(400).send('绑定失败'); 
    }
});

// 微信配置接口（仅返回AppID，不返回Secret）
app.get('/api/config/wechat-appid', async (req, res) => {
    try {
        const appid = process.env.WECHAT_APPID;
        if (appid) {
            res.json({ appid });
        } else {
            res.status(404).json({ error: '未配置微信AppID' });
        }
    } catch (e) {
        res.status(500).json({ error: '获取配置失败' });
    }
});

// 微信JS-SDK配置缓存（内存缓存）
const wechatConfigCache = {
    accessToken: null,
    accessTokenExpire: 0,
    jsapiTicket: null,
    jsapiTicketExpire: 0
};

// 获取access_token（带缓存）
async function getAccessToken(appid, secret) {
    const now = Date.now();
    
    // 如果缓存有效，直接返回
    if (wechatConfigCache.accessToken && now < wechatConfigCache.accessTokenExpire) {
        console.log('[Wechat Config] 使用缓存的access_token');
        return wechatConfigCache.accessToken;
    }
    
    try {
        console.log('[Wechat Config] 获取新的access_token');
        const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();
        
        if (tokenData.errcode) {
            console.error('[Wechat Config] 获取access_token失败:', tokenData);
            
            // 特殊处理IP白名单错误
            if (tokenData.errcode === 40164) {
                throw new Error('IP白名单限制: 服务器IP未在微信公众平台白名单中，请在微信公众平台添加IP: 47.96.100.205');
            }
            
            throw new Error('获取access_token失败: ' + (tokenData.errmsg || tokenData.errcode));
        }
        
        // 缓存access_token，有效期7200秒，提前5分钟过期
        wechatConfigCache.accessToken = tokenData.access_token;
        wechatConfigCache.accessTokenExpire = now + (tokenData.expires_in - 300) * 1000;
        
        return tokenData.access_token;
    } catch (error) {
        console.error('[Wechat Config] 获取access_token异常:', error);
        throw error;
    }
}

// 获取jsapi_ticket（带缓存）
async function getJsapiTicket(accessToken) {
    const now = Date.now();
    
    // 如果缓存有效，直接返回
    if (wechatConfigCache.jsapiTicket && now < wechatConfigCache.jsapiTicketExpire) {
        console.log('[Wechat Config] 使用缓存的jsapi_ticket');
        return wechatConfigCache.jsapiTicket;
    }
    
    try {
        console.log('[Wechat Config] 获取新的jsapi_ticket');
        const ticketUrl = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi&access_token=${accessToken}`;
        const ticketRes = await fetch(ticketUrl);
        const ticketData = await ticketRes.json();
        
        if (ticketData.errcode !== 0) {
            console.error('[Wechat Config] 获取jsapi_ticket失败:', ticketData);
            throw new Error('获取jsapi_ticket失败: ' + (ticketData.errmsg || ticketData.errcode));
        }
        
        // 缓存jsapi_ticket，有效期7200秒，提前5分钟过期
        wechatConfigCache.jsapiTicket = ticketData.ticket;
        wechatConfigCache.jsapiTicketExpire = now + (ticketData.expires_in - 300) * 1000;
        
        return ticketData.ticket;
    } catch (error) {
        console.error('[Wechat Config] 获取jsapi_ticket异常:', error);
        throw error;
    }
}

// 微信JS-SDK配置接口（用于分享功能）
app.get('/api/wechat/config', async (req, res) => {
    try {
        const appid = process.env.WECHAT_APPID;
        const secret = process.env.WECHAT_SECRET;
        
        if (!appid || !secret) {
            console.warn('[Wechat Config] 未配置微信AppID或Secret');
            return res.status(404).json({ 
                success: false, 
                error: '未配置微信AppID或Secret' 
            });
        }

        // 生成随机字符串和时间戳
        const nonceStr = Math.random().toString(36).substring(2, 15) + 
                        Math.random().toString(36).substring(2, 15);
        const timestamp = Math.floor(Date.now() / 1000);
        
        // 获取access_token（带缓存）
        const accessToken = await getAccessToken(appid, secret);
        
        // 获取jsapi_ticket（带缓存）
        const jsapiTicket = await getJsapiTicket(accessToken);
        
        // 生成签名
        const url = req.query.url || req.headers.referer || '';
        if (!url) {
            console.warn('[Wechat Config] URL参数为空');
        }
        
        const signString = `jsapi_ticket=${jsapiTicket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
        
        // 使用crypto生成sha1签名
        const crypto = require('crypto');
        const signature = crypto.createHash('sha1').update(signString).digest('hex');
        
        console.log('[Wechat Config] 配置生成成功，URL:', url.substring(0, 50) + '...');
        
        res.json({
            success: true,
            config: {
                appId: appid,
                timestamp: timestamp,
                nonceStr: nonceStr,
                signature: signature
            }
        });
    } catch (e) {
        console.error('[Wechat Config Error]', e);
        console.error('[Wechat Config Error Stack]', e.stack);
        
        // 如果是IP白名单错误，返回特殊错误码，让前端知道可以使用降级方案
        const isIpWhitelistError = e.message && e.message.includes('IP白名单');
        
        res.status(500).json({ 
            success: false, 
            error: '获取微信配置失败: ' + (e.message || '未知错误'),
            errorCode: isIpWhitelistError ? 'IP_WHITELIST_ERROR' : 'UNKNOWN_ERROR',
            fallback: true, // 提示前端可以使用降级方案（复制文字）
            details: process.env.NODE_ENV === 'development' ? e.stack : undefined
        });
    }
});

// 项目注意事项接口
app.get('/api/precautions/projects', async (req, res) => {
    try {
        // 获取查询参数 project
        const projectParam = req.query.project || '';
        
        // 从 WPS 获取项目注意事项数据
        const apiUrl = `/api/v5${projectParam ? `?project=${encodeURIComponent(projectParam)}` : ''}`;
        const mockRequest = {
            url: `${req.protocol}://${req.get('host')}${apiUrl}`,
            method: 'GET',
            headers: { get: (name) => req.get(name) },
        };
        
        const workerResponse = await handleWpsRequest(mockRequest, {});
        const responseText = await workerResponse.text();
        let wpsData;
        
        try {
            wpsData = JSON.parse(responseText);
        } catch (parseError) {
            console.error('[Projects API] JSON解析失败:', parseError);
            console.error('[Projects API] 原始响应:', responseText);
            return res.json({ success: true, data: [] });
        }
        
        console.log('[Projects API] WPS 原始数据:', JSON.stringify(wpsData, null, 2));
        
        // 处理 WPS 返回的数据 - 根据实际数据结构处理
        let records = [];
        
        // 数据结构：可能是 [{records: [...]}] 或 {success: true, data: [{records: [...]}]}
        if (wpsData && wpsData.success && wpsData.data) {
            // 情况1: {success: true, data: [{records: [...]}]}
            if (Array.isArray(wpsData.data) && wpsData.data.length > 0) {
                const firstItem = wpsData.data[0];
                if (firstItem && firstItem.records && Array.isArray(firstItem.records)) {
                    records = firstItem.records;
                } else if (Array.isArray(firstItem)) {
                    records = firstItem;
                } else {
                    records = wpsData.data;
                }
            } else if (wpsData.data.records && Array.isArray(wpsData.data.records)) {
                records = wpsData.data.records;
            } else if (wpsData.data.result) {
                const result = wpsData.data.result;
                if (Array.isArray(result) && result.length > 0 && result[0].records) {
                    records = result[0].records;
                } else if (Array.isArray(result)) {
                    records = result;
                } else if (result.records && Array.isArray(result.records)) {
                    records = result.records;
                }
            }
        } else if (Array.isArray(wpsData)) {
            // 情况2: 直接是数组 [{records: [...]}]
            if (wpsData.length > 0 && wpsData[0].records && Array.isArray(wpsData[0].records)) {
                records = wpsData[0].records;
            } else {
                records = wpsData;
            }
        } else if (wpsData && wpsData.records && Array.isArray(wpsData.records)) {
            // 情况3: {records: [...]}
            records = wpsData.records;
        }
        
        console.log('[Projects API] 提取到的记录数:', records.length);
        console.log('[Projects API] 第一条记录示例:', records.length > 0 ? JSON.stringify(records[0], null, 2) : '无记录');
        
        if (!Array.isArray(records) || records.length === 0) {
            console.warn('[Projects API] 没有找到有效记录，原始数据结构:', JSON.stringify(wpsData, null, 2));
            return res.json({ success: true, data: [] });
        }
        
        // 将 WPS 数据格式转换为前端需要的格式
        const projects = records.map((item, index) => {
            // 处理不同的数据结构 - 根据实际数据，item 应该是 {fields: {...}, id: "..."}
            let fields = item;
            if (item.fields) {
                fields = item.fields;
            } else if (item.record && item.record.fields) {
                fields = item.record.fields;
            }
            
            // 字段映射：ID -> id, 项目 -> name, 注意事项 -> precautions, 图标 -> icon
            const id = fields['ID'] || fields['id'] || fields['Id'] || fields['序号'] || (index + 1);
            const name = fields['项目'] || fields['项目名称'] || fields['name'] || fields['名称'] || '未命名项目';
            const precautions = fields['注意事项'] || fields['precautions'] || fields['内容'] || '';
            const iconField = fields['图标'] || fields['icon'] || fields['Icon'] || fields['图标URL'] || '';
            
            // 处理图标：如果是 Font Awesome 类名，直接使用；如果是 URL，需要特殊处理
            let icon = 'fa-solid fa-clipboard-list'; // 默认图标
            if (iconField) {
                const iconStr = String(iconField).trim();
                // 如果包含 fa- 或 fas 等，说明是 Font Awesome 类名
                if (iconStr.includes('fa-') || iconStr.includes('fas ') || iconStr.includes('fa-solid')) {
                    icon = iconStr;
                } else if (iconStr.startsWith('http')) {
                    // 如果是 URL，使用默认图标（后续可以扩展支持图片）
                    icon = 'fa-solid fa-image';
                } else if (iconStr.length > 0) {
                    // 尝试作为 Font Awesome 类名
                    icon = iconStr.startsWith('fa-') ? iconStr : `fa-solid fa-${iconStr}`;
                }
            }
            
            return {
                id: typeof id === 'string' ? (parseInt(id.replace(/\D/g, '')) || (index + 1)) : (id || (index + 1)),
                name: String(name || '未命名项目'),
                icon: icon,
                precautions: String(precautions || '')
            };
        }).filter(item => item.name && item.name !== '未命名项目' && item.name.trim() !== ''); // 过滤空数据
        
        console.log('[Projects API] 转换后的项目数:', projects.length);
        
        res.json({ success: true, data: projects });
    } catch (e) {
        console.error('[Projects API Error]', e);
        console.error('[Projects API Error Stack]', e.stack);
        // 出错时返回空数组，前端会使用备用数据
        res.json({ 
            success: true, 
            data: [] 
        });
    }
});

// 用户信息接口
app.get('/api/user/info', async (req, res) => {
    try {
        const token = req.cookies.auth_token;
        if (!token) return res.status(401).json({ error: '未登录' });
        
        const user = await Jwt.verify(token, process.env.JWT_SECRET);
        
        if (user && user.phone) {
            // 验证用户是否还在WPS中存在
            const userExists = await Auth.checkPhoneInWps(user.phone);
            if (!userExists) {
                // 用户已被删除，清除相关缓存并返回未登录
                if (user.openid) {
                    Auth.clearOpenIdCache(user.openid, user.phone);
                }
                return res.status(401).json({ error: '用户不存在' });
            }

            // 重新获取用户信息（确保信息是最新的）
            const userInfo = await Auth.getUserInfo(user.phone);
            if (!userInfo) {
                // 无法获取用户信息，可能已被删除
                if (user.openid) {
                    Auth.clearOpenIdCache(user.openid, user.phone);
                }
                return res.status(401).json({ error: '用户信息获取失败' });
            }

            const displayName = userInfo.name || user.name || user.phone;
            const displayRole = userInfo.role || user.role || '员工';

            res.json({ 
                isLoggedIn: true, 
                phone: user.phone, 
                name: displayName, 
                role: displayRole 
            });
        } else { 
            res.status(401).json({ error: 'Token 无效' }); 
        }
    } catch (e) { 
        console.error('[User Info Error]', e);
        res.status(500).json({ error: '系统错误' }); 
    }
});

// 菜单接口
app.get('/api/app/menu', async (req, res) => {
    try {
        const token = req.cookies.auth_token;
        if (!token) return res.status(401).json({ error: '未登录' });
        const user = await Jwt.verify(token, process.env.JWT_SECRET);
        if (!user) return res.status(401).json({ error: 'Token 无效' });

        const currentRole = user.role || '员工';
        const rawApps = await WPS.getAppMenu(currentRole);

        const result = rawApps.map(item => {
            const fields = item.fields || item;
            return {
                name: fields['名称'] || fields['name'] || '未命名',
                url: fields['URL'] || fields['链接'] || fields['url'] || '#',
                icon: fields['ICONURL'] || fields['img'] || '',
                type: fields['类型'] || '常用应用' 
            };
        });
        res.json(result);
    } catch (e) { res.status(500).json({ error: '获取菜单失败' }); }
});


// 美容师手工数据接口
app.get('/api/manual/data', async (req, res) => {
    try {
        const token = req.cookies.auth_token;
        if (!token) return res.status(401).json({ error: '未登录' });
        
        const user = await Jwt.verify(token, process.env.JWT_SECRET);
        if (!user || !user.phone) return res.status(401).json({ error: 'Token 无效' });

        const data = await fetchManualData(user.phone);
        res.json({ success: true, data: data });
    } catch (e) {
        console.error("❌ 获取手工数据失败:", e);
        res.status(500).json({ error: '获取数据失败' });
    }
});

// 业务 API 中间件：注入 currentUserPhone
app.use('/api', async (req, res, next) => {
    if (req.path === '/scheduler' && req.method === 'POST') {
        const token = req.cookies.auth_token;
        if (token) {
            const user = await Jwt.verify(token, process.env.JWT_SECRET);
            if (user) req.body.currentUserPhone = user.phone;
        }
    }
    next();
});

// === Scheduler 相关接口 ===

app.all('/api/scheduler', (req, res) => {
    const mockRequest = {
        url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: req.method,
        headers: { get: (name) => req.get(name) },
    };
    sendWorkerResponse(res, handleSchedulerRequest(mockRequest, req.body));
});

// 【修改2】新增取消预约的接口路由
app.post('/api/cancel_schedule', (req, res) => {
    // 构造一个模拟的 Request 对象传给 handler
    const mockRequest = {
        url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: req.method,
        headers: { get: (name) => req.get(name) },
    };
    // 直接使用 express 解析好的 req.body
    sendWorkerResponse(res, handleCancelRequest(mockRequest, req.body));
});
// === 新增：查询历史记录接口 ===
app.get('/api/history', async (req, res) => {
    try {
        // 1. 鉴权：获取当前登录用户手机号
        const token = req.cookies.auth_token;
        if (!token) return res.status(401).json({ error: '未登录' });
        
        const user = await Jwt.verify(token, process.env.JWT_SECRET);
        if (!user || !user.phone) return res.status(401).json({ error: 'Token 无效' });

        // 2. 获取前端传递的日期参数
        const { startDate, endDate } = req.query;

        // 简单校验
        if (!startDate || !endDate) {
            return res.status(400).json({ error: '缺少日期参数 (startDate, endDate)' });
        }

        // 3. 调用处理函数
        // user.phone 来自 Token，确保了用户只能查自己的数据
        const result = await handleHistoryRequest(startDate, endDate, user.phone);

        // 4. 返回结果
        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }

    } catch (e) {
        console.error("API Error:", e);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// === 其他接口 ===

app.all(['/api/v1', '/api/v2', '/api/v3', '/api/v4', '/api/v5'], (req, res) => {
    const mockRequest = {
        url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: req.method,
        headers: { get: (name) => req.get(name) },
    };
    sendWorkerResponse(res, handleWpsRequest(mockRequest, req.body));
});

// 全局页面鉴权
app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith('/api')) return next();
    if (p === '/login.html') return next();
    // 允许微信验证等txt文件直接访问
    if (p === '/90706fcedf7a98c4d604c7c25e6439f9.txt' || 
        p === '/MP_verify_FcNmgsq82Ahz44Sh.txt' ||
        p === '/favicon.ico' || 
        p.match(/\.(png|jpg|jpeg|gif|svg|css|js|map|woff|woff2|ttf)$/i)) {
        return next();
    }

    const token = req.cookies.auth_token;
    if (!token) return res.redirect('/login.html');

    next();
});

app.use(express.static(path.join(__dirname, '../dist'), {
    extensions: ['html'], 
    index: ['index.html'] 
}));

app.use((req, res) => {
    res.status(404).send('Not Found: ' + req.path);
});

const PORT = 9000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});