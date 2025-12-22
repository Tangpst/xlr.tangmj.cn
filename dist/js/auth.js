// 文件路径: dist/js/auth.js
(function(window) {
    // 确保 Vue 已经加载
    if (!window.Vue) {
        console.error("请先加载 Vue3，再加载 auth.js");
        return;
    }

    const { reactive, ref, computed } = window.Vue;

    // 全局单例状态（避免多处引用导致状态不同步）
    const state = reactive({
        user: {
            phone: '',
            role: '',     // 关键字段：股东、员工、美容师等
            name: '',
            isLoggedIn: false
        },
        loading: true
    });

    /**
     * 获取用户信息
     * @param {boolean} redirectIfFail - 如果未登录是否自动跳转到登录页（默认 false）
     */
    async function fetchUser(redirectIfFail = false) {
        state.loading = true;
        try {
            const res = await fetch('/api/user/info');
            if (res.ok) {
                const data = await res.json();
                if (data.isLoggedIn) {
                    state.user.phone = String(data.phone || '');
                    state.user.role = data.role || '员工';
                    state.user.name = data.name || '';
                    state.user.isLoggedIn = true;
                    console.log(`[Auth] 用户已登录: ${state.user.name} (${state.user.role})`);
                    return state.user;
                }
            }
            // 未登录处理
            if (redirectIfFail) {
                window.location.href = '/login.html';
            }
        } catch (e) {
            console.error("[Auth] 获取信息失败:", e);
        } finally {
            state.loading = false;
        }
        return null;
    }

    /**
     * 辅助函数：判断是否是股东
     */
    const isShareholder = computed(() => state.user.role === '股东');

    /**
     * 辅助函数：判断传入的手机号是否是当前用户
     * @param {string|number} targetPhone 
     */
    function isMe(targetPhone) {
        if (!targetPhone) return false;
        return String(targetPhone) === String(state.user.phone);
    }

    // 暴露给全局 window 对象，方便在 setup() 中使用
    window.useAuth = function() {
        return {
            authUser: state.user,     // 用户对象
            authLoading: state.loading, // 加载状态
            isShareholder,            // 是否股东（计算属性）
            fetchUser,                // 获取数据的方法
            isMe                      // 判断是否是自己的方法
        };
    };

})(window);