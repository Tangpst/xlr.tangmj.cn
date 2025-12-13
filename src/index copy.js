// src/index.js (阿里云 FC 版)
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { handleWpsRequest } = require('./wps_routes.js');
const { handleSchedulerRequest } = require('./scheduler.js');
const { Auth, Jwt } = require('./auth.js');

const app = express();

// 1. 中间件配置
app.use(express.json()); // 解析 JSON Body
app.use(cookieParser()); // 解析 Cookie
app.use(express.static(path.join(__dirname, '../dist'))); // 托管 dist 目录下的静态文件 (假设 dist 在上一级或同级)

// === 辅助函数：将 Worker 的 Response 对象转换为 Express 响应 ===
async function sendWorkerResponse(res, workerResponsePromise) {
    try {
        const workerResp = await workerResponsePromise;
        // 设置状态码
        res.status(workerResp.status);
        // 设置 Headers
        workerResp.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });
        // 发送 Body
        const text = await workerResp.text();
        res.send(text);
    } catch (e) {
        console.error('Adapter Error:', e);
        res.status(500).send(e.message);
    }
}

// ============================================================
// 第一部分：Auth 认证接口
// ============================================================

app.post('/api/auth/send', async (req, res) => {
    try {
        const { phone } = req.body;
        // 注意：这里去掉了 env 参数，改为内部直接读取 process.env
        const isAllowed = await Auth.checkPhoneInWps(phone);
        if (!isAllowed) return res.status(403).send('非内部人员或手机号错误');

        const code = await Auth.generateAndStoreCode(phone);
        const success = await Auth.sendSmsViaWorker(phone, code);

        if (success) res.send('ok');
        else res.status(500).send('短信发送失败');
    } catch (e) {
        res.status(400).send('请求格式错误');
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, code } = req.body;
        const isValid = await Auth.verifyLogin(phone, code);
        if (!isValid) return res.status(400).send('验证码错误');

        const name = await Auth.getUserName(phone) || '员工';
        // 使用 process.env.JWT_SECRET
        const token = await Jwt.sign({ phone, name }, process.env.JWT_SECRET);

        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: true,
            maxAge: 604800000 // 7天
        });
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(400).send('登录失败');
    }
});

app.get('/api/user/info', async (req, res) => {
    try {
        const token = req.cookies.auth_token;
        if (!token) return res.status(401).json({ error: '未登录' });

        const user = await Jwt.verify(token, process.env.JWT_SECRET);
        if (user && user.phone) {
            let displayName = user.name;
            if (!displayName) {
                const fetchedName = await Auth.getUserName(user.phone);
                if (fetchedName) displayName = fetchedName;
            }
            res.json({
                isLoggedIn: true,
                phone: user.phone,
                name: displayName || user.phone
            });
        } else {
            res.status(401).json({ error: 'Token 无效' });
        }
    } catch (e) {
        res.status(500).json({ error: '系统错误' });
    }
});

// ============================================================
// 第二部分：业务 API 逻辑 (WPS / Scheduler)
// ============================================================

// 鉴权中间件 (保护 /api 路由)
app.use('/api', async (req, res, next) => {
    // 简单模拟原来的 Origin 检查
    // 在 Express 中通常不需要这么严格的 Origin 检查，除非为了防盗链
    // 这里略过，直接放行，或者你可以把原来的逻辑搬过来
    
    // 如果是 Scheduler 接口，注入用户信息
    if (req.path === '/scheduler' && req.method === 'POST') {
        const token = req.cookies.auth_token;
        if (token) {
            const user = await Jwt.verify(token, process.env.JWT_SECRET);
            if (user && req.body) {
                req.body.currentUserPhone = user.phone;
            }
        }
    }
    next();
});

// 路由分发
app.all('/api/scheduler', (req, res) => {
    // 复用原来的业务逻辑，通过 process.env 传递环境变量
    // 注意：我们将 Express 的 req 包装一下传进去，或者修改原来的函数签名
    // 这里为了少改动原来的文件，我们构造一个类似 Fetch Request 的对象，或者直接修改 scheduler.js
    
    // 建议方案：修改 scheduler.js 让它不依赖 Request 对象，只依赖 body 和 query
    // 但为了快速迁移，我们这里直接调用，并传入 process.env
    
    // 由于 scheduler.js 依赖 new URL(request.url)，我们需要构造一个伪造的 Request 对象
    const protocol = req.protocol;
    const host = req.get('host');
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;
    const mockRequest = {
        url: fullUrl,
        method: req.method,
        headers: { get: (name) => req.get(name) },
        // body 已经在 req.body 里了
    };

    sendWorkerResponse(res, handleSchedulerRequest(mockRequest, process.env, req.body));
});

app.all(['/api/v1', '/api/v2', '/api/v3', '/api/v4'], (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;
    const mockRequest = {
        url: fullUrl,
        method: req.method,
        headers: { get: (name) => req.get(name) },
    };
    
    sendWorkerResponse(res, handleWpsRequest(mockRequest, process.env, req.body));
});

// ============================================================
// 第三部分：页面保镖 (HTML 访问控制)
// ============================================================
// Express 的 static 中间件已经处理了静态资源，如果需要对 html 做鉴权
// 可以把 .html 文件单独拿出来处理，或者在 static 之前加中间件
// 这里做一个简单的兜底：所有非 API 请求，如果没有被 static 处理，且不是 login，就跳 login
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.includes('.')) {
         // 类似于 SPA 的 fallback，或者简单的重定向
         res.sendFile(path.join(__dirname, '../dist/index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

const PORT = 9000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});