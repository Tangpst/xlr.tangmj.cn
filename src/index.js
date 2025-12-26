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

app.all(['/api/v1', '/api/v2', '/api/v3', '/api/v4'], (req, res) => {
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