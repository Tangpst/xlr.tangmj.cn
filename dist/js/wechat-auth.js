// 微信无感登录工具
(function(window) {
    /**
     * 检测是否在微信环境中
     */
    function isWechatBrowser() {
        const ua = navigator.userAgent.toLowerCase();
        return ua.indexOf('micromessenger') !== -1;
    }

    /**
     * 获取URL参数
     */
    function getUrlParam(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    /**
     * 获取微信授权code（通过URL重定向）
     */
    function getWechatCode() {
        return getUrlParam('code');
    }

    /**
     * 获取微信AppID（从后端配置获取）
     */
    async function getWechatAppId() {
        try {
            // 尝试从后端获取配置（如果后端提供配置接口）
            const response = await fetch('/api/config/wechat-appid');
            if (response.ok) {
                const data = await response.json();
                return data.appid;
            }
        } catch (e) {
            console.warn('[Wechat] 无法从后端获取AppID，使用默认值');
        }
        // 如果后端没有配置，返回null，前端需要手动配置
        return null;
    }

    /**
     * 跳转到微信授权页面
     */
    async function redirectToWechatAuth() {
        let appid = await getWechatAppId();
        
        // 如果后端没有配置，尝试从window全局变量获取（可以在HTML中设置）
        if (!appid && window.WECHAT_APPID) {
            appid = window.WECHAT_APPID;
        }
        
        if (!appid) {
            console.error('[Wechat] 未配置微信AppID，无法进行微信登录');
            return;
        }

        const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
        const scope = 'snsapi_base'; // 静默授权，不需要用户确认
        const state = 'wechat_login'; // 可选，用于防止CSRF
        
        const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appid}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}#wechat_redirect`;
        
        window.location.href = authUrl;
    }

    /**
     * 尝试微信自动登录
     */
    async function tryWechatAutoLogin() {
        // 1. 检查是否在微信环境
        if (!isWechatBrowser()) {
            return { success: false, reason: 'not_wechat' };
        }

        // 2. 检查URL中是否有code
        const code = getWechatCode();
        if (!code) {
            // 如果没有code，跳转到授权页面
            await redirectToWechatAuth();
            return { success: false, reason: 'redirecting' };
        }

        // 3. 调用后端登录接口
        try {
            const response = await fetch('/api/auth/wechat-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            const data = await response.json();

            if (data.success) {
                // 登录成功，清除URL中的code参数
                const url = new URL(window.location.href);
                url.searchParams.delete('code');
                url.searchParams.delete('state');
                window.history.replaceState({}, '', url);
                
                return { success: true, data };
            } else if (data.needBind) {
                // 需要绑定手机号
                return { success: false, needBind: true, openid: data.openid };
            } else {
                return { success: false, reason: 'login_failed', message: data.message || data.error };
            }
        } catch (e) {
            console.error('[Wechat Auth] 登录请求失败:', e);
            return { success: false, reason: 'network_error', error: e };
        }
    }

    /**
     * 绑定手机号
     */
    async function bindPhone(openid, phone, code) {
        try {
            const response = await fetch('/api/auth/wechat-bind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ openid, phone, code })
            });

            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[Wechat Auth] 绑定失败:', e);
            return { success: false, error: e.message };
        }
    }

    // 暴露给全局
    window.wechatAuth = {
        isWechatBrowser,
        tryWechatAutoLogin,
        bindPhone,
        redirectToWechatAuth
    };

})(window);

