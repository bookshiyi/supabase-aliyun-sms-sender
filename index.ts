// Deno 原生实现阿里云短信发送，适配 Supabase Auth Hook
// 参考：https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
// 参考：https://github.com/orgs/supabase/discussions/33699
// 参考：https://api.aliyun.com/document/Dysmsapi/2017-05-25/SendSms

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

// 环境变量检查
function getEnvOrThrow(key: string): string {
  const value = Deno.env.get(key)
  if (!value)  throw new Error(`Environment variable ${key} is not set`)
  return value
}

const ACCESS_KEY_ID = getEnvOrThrow('ALIYUN_ACCESS_KEY_ID')
const ACCESS_KEY_SECRET = getEnvOrThrow('ALIYUN_ACCESS_KEY_SECRET')
const SMS_SIGN_NAME = getEnvOrThrow('ALIYUN_SMS_SIGN_NAME')
const SMS_TEMPLATE_CODE = getEnvOrThrow('ALIYUN_SMS_TEMPLATE_CODE')
const HOOK_SECRET = getEnvOrThrow('SEND_SMS_HOOK_SECRET')

// 阿里云短信API endpoint
const ENDPOINT = 'https://dysmsapi.aliyuncs.com/';

// 生成ISO8601时间戳
function getISOTime() {
  return new Date().toISOString().replace(/\.(\d{3})Z$/, 'Z');
}

// 生成随机字符串
function randomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 阿里云签名算法
async function signAliyun(params: Record<string, string>, accessKeySecret: string) {
  // 1. 参数排序
  const sorted = Object.keys(params).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&');
  // 2. 构造待签名字符串
  const stringToSign = `POST&%2F&${encodeURIComponent(sorted)}`;
  // 3. HMAC-SHA1 签名
  const key = accessKeySecret + '&';
  const encoder = new TextEncoder();
  const keyBuf = encoder.encode(key);
  const dataBuf = encoder.encode(stringToSign);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuf);
  // 4. Base64 encode
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// 发送短信
async function sendAliyunSms(phone: string, code: string) {
  const params: Record<string, string> = {
    AccessKeyId: ACCESS_KEY_ID,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: SMS_SIGN_NAME,
    TemplateCode: SMS_TEMPLATE_CODE,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: getISOTime(),
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomString(24),
    Version: '2017-05-25',
  };
  // 生成签名
  const signature = await signAliyun(params, ACCESS_KEY_SECRET);
  params.Signature = signature;

  // 构造请求体
  const body = new URLSearchParams(params).toString();

  // 发送 POST 请求
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await resp.json();
  if (data.Code !== 'OK')  throw new Error(data.Message || 'Aliyun SMS send failed');
  return data;
}

// 主函数
Deno.serve(async (req: Request) => {
  const response_headers = { 'Content-Type': 'application/json' }
  try {
    const payload = await req.text()
    const base64_secret = HOOK_SECRET.replace('v1,whsec_', '')
    const headers = Object.fromEntries(req.headers)
    const wh = new Webhook(base64_secret)
    let event 
    // 1. webhook 签名校验
    try {
      event = wh.verify(payload, headers) // 验证webhook签名
    } catch (error) {
      return new Response(JSON.stringify({ error: { http_code: 401, message: 'Unauthorized: signature error' } }), { status: 401, headers: response_headers })
    }
    // 2. 方法校验
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: { http_code: 405, message: 'Method Not Allowed' } }), { status: 405, headers: response_headers })
    
    // 3. 获取手机号和验证码
    const phone = event.user?.phone
    const code = event.sms?.otp
    if (!phone || !code) return new Response(JSON.stringify({ error: { http_code: 400, message: 'Missing phone or otp code' } }), { status: 400, headers: response_headers })
    
    // 4. 发送短信
    const result = await sendAliyunSms(phone, code)
    if (result.Code == 'OK') {
      return new Response(JSON.stringify({ msg: 'SMS sent successfully', result }), { status: 200, headers: response_headers })
    } else {
      return new Response(JSON.stringify({ error: { http_code: 500, message: result.Message || 'Aliyun SMS send failed' } }), { status: 500, headers: response_headers })
    }
  } catch (e: any) {
    console.error('[Error]:', e)
    return new Response(JSON.stringify({ error: { http_code: 500, message: e.message || 'Internal error' } }), { status: 500, headers: response_headers })
  }
}) 