// src/index.js (最终完美版)
import dotenv from 'dotenv';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleWpsRequest } from './wps_routes.js';
import { handleSchedulerRequest } from './scheduler.js';
import { Auth, Jwt } from './auth.js';

// 加载环境变量
dotenv.config();

// ESM 兼容 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 1. 基础中间件
app.use(express.json());
app.use(cookieParser());

// === 辅助函数：Worker Response 适配器 ===
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
// 第一部分：API 接口 (优先级最高，不需要网页鉴权)
// ============================================================

// 登录相关 API
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

app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, code } = req.body;
        const isValid = await Auth.verifyLogin(phone, code);
        if (!isValid) return res.status(400).send('验证码错误');

        const name = await Auth.getUserName(phone) || '员工';
        const token = await Jwt.sign({ phone, name }, process.env.JWT_SECRET);

        res.cookie('auth_token', token, { httpOnly: true, secure: true, maxAge: 604800000 });
        res.json({ success: true });
    } catch (e) { res.status(400).send('登录失败'); }
});

// 用户信息 API (自带鉴权)
app.get('/api/user/info', async (req, res) => {
    try {
        const token = req.cookies.auth_token;
        if (!token) return res.status(401).json({ error: '未登录' });
        const user = await Jwt.verify(token, process.env.JWT_SECRET);
        if (user && user.phone) {
            let displayName = user.name || await Auth.getUserName(user.phone) || user.phone;
            res.json({ isLoggedIn: true, phone: user.phone, name: displayName });
        } else { res.status(401).json({ error: 'Token 无效' }); }
    } catch (e) { res.status(500).json({ error: '系统错误' }); }
});

// 业务 API (Scheduler & WPS)
app.use('/api', async (req, res, next) => {
    // 简单的 API 鉴权中间件
    if (req.path === '/scheduler' && req.method === 'POST') {
        const token = req.cookies.auth_token;
        if (token) {
            const user = await Jwt.verify(token, process.env.JWT_SECRET);
            if (user) req.body.currentUserPhone = user.phone;
        }
    }
    next();
});

app.all('/api/scheduler', (req, res) => {
    const mockRequest = {
        url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: req.method,
        headers: { get: (name) => req.get(name) },
    };
    sendWorkerResponse(res, handleSchedulerRequest(mockRequest, req.body));
});

app.all(['/api/v1', '/api/v2', '/api/v3', '/api/v4'], (req, res) => {
    const mockRequest = {
        url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        method: req.method,
        headers: { get: (name) => req.get(name) },
    };
    sendWorkerResponse(res, handleWpsRequest(mockRequest, req.body));
});

// ============================================================
// 第二部分：全局页面鉴权 (保安)
// ============================================================
// 这里的逻辑会在 express.static 之前执行！

app.use((req, res, next) => {
    const p = req.path;

    // 1. 如果是 API，上面已经处理过了，或者不归这里管，放行
    if (p.startsWith('/api')) return next();

    // 2. 如果是 登录页，直接放行
    if (p === '/login.html') return next();

    // 3. 如果是 静态资源 (图片、样式、JS脚本)，直接放行
    //    判断逻辑：以常见扩展名结尾，或者 favicon
    if (p === '/favicon.ico' || 
        p.match(/\.(png|jpg|jpeg|gif|svg|css|js|map|woff|woff2|ttf)$/i)) {
        return next();
    }

    // 4. 剩下的都是“页面访问” (/, /clinic, /daka.html 等)
    //    必须检查 Token！
    const token = req.cookies.auth_token;
    
    if (!token) {
        // 没登录 -> 滚去登录
        return res.redirect('/login.html');
    }

    // 已登录 -> 放行，交给下面的 static 去找文件
    next();
});

// ============================================================
// 第三部分：静态文件服务 (支持无后缀)
// ============================================================

app.use(express.static(path.join(__dirname, '../dist'), {
    // 核心修改：extensions 允许你省略 .html 后缀
    // 访问 /clinic 会自动找 /clinic.html
    extensions: ['html'], 
    index: ['index.html'] 
}));

// ============================================================
// 第四部分：404 兜底
// ============================================================
app.use((req, res) => {
    res.status(404).send('Not Found: ' + req.path);
});

const PORT = 9000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});