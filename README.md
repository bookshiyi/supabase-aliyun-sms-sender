# Supabase Aliyun SMS Sender

适配Supabase的[`send_sms_hook`](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)的[阿里云短信](https://api.aliyun.com/document/Dysmsapi/2017-05-25/SendSms)发送云函数，运行在`edge-functions`容器中。

## 特点

- 解决Supabase官方未支持国内的短信服务商问题
- 函数内会验证webhook签名，防止接口被滥用
- 时序图：
```mermaid
sequenceDiagram
    participant frontend
    box Container
        participant auth
        participant edge-functions
    end
    box Deno
        participant main
        participant aliyun-sms-sender
    end
    box AlibabaCloud
    participant AliyunSMS
    end

    frontend->>auth: 请求发送短信验证码
    auth->>edge-functions: 触发 send_sms_hook
    edge-functions->>main: 事件转发
    main->>aliyun-sms-sender: 路由到云函数
    aliyun-sms-sender->>AliyunSMS: 调用短信发送API
    note over AliyunSMS: 向运营商提起短信请求
    AliyunSMS-->>aliyun-sms-sender: 返回结果
    aliyun-sms-sender-->>main: 返回结果
    main-->>edge-functions: 返回结果
    edge-functions-->>auth: 返回结果
    auth-->>frontend: 返回验证码发送状态
```

## 配置

1. 将本仓库放在`volumes/functions/`目录下，和`main`文件夹平级

2. 修改`compose.yaml` 配置:

``` diff
services:
    # ...
    auth:
        # ...
++      extra_hosts:
++          - "host.docker.internal:host-gateway"
        environment:
            #...
++          GOTRUE_HOOK_SEND_SMS_ENABLED: "true"
++          GOTRUE_HOOK_SEND_SMS_URI: "http://host.docker.internal:8000/functions/v1/supabase-aliyun-sms-sender"
++          GOTRUE_HOOK_SEND_SMS_SECRETS: "v1,whsec_REPLACE_WITH_YOUR_SECRET"
            #...
        #...
    #...
    functions:
        #...
        environment:
            #...
++          ALIYUN_ACCESS_KEY_ID: "REPLACE_WITH_YOUR_ACCESS_KEY_ID"
++          ALIYUN_ACCESS_KEY_SECRET: "REPLACE_WITH_YOUR_ACCESS_KEY_SECRET"
++          ALIYUN_SMS_SIGN_NAME: "REPLACE_WITH_YOUR_SIGN_NAME"
++          ALIYUN_SMS_TEMPLATE_CODE: "REPLACE_WITH_YOUR_TEMPLATE_CODE"
++          SEND_SMS_HOOK_SECRET: "v1,whsec_REPLACE_WITH_YOUR_SECRET"
        #...
    #...
```

3. 重新创建`docker compose`（需要环境变量生效）

## 使用

- 前端调用(REST)：
``` bash
curl -X POST http://your-domain.com/auth/v1/otp 
     -H "Content-Type: application/json" 
     -H "Authorization: Bearer replace-with-your-secret"
     -d '{"phone": "13012341234"}'
```
- SDK调用：
``` js
const { data, error } = await supabase.auth.signInWithOtp({
  phone: '+13012341234',
})
```

## 调试 

- `gotrue`封装了错误的具体消息内容，即便云函数返回了具体错误信息，前端也无法获取到，只能得到类似 `Internal error` 500 的错误。
- 每次修改`index.ts`代码后，需要通过命令 `docker compose restart supabase-functions` 重启edge-functions服务，才能生效。
- 查看`gotrue`日志：`docker logs -f supabase-auth` 
- 查看`edge-functions`日志：`docker logs -f supabase-edge-functions`


## 参考
- https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
- https://github.com/orgs/supabase/discussions/33699
- https://api.aliyun.com/document/Dysmsapi/2017-05-25/SendSms