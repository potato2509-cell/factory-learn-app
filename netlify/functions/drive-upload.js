// netlify/functions/drive-upload.js
// 학습앱 → Apps Script로 이미지 업로드 중계
// Node.js 14+ 호환 (https 모듈 사용, fetch/AbortSignal 의존성 없음)

const https = require("https");
const { URL } = require("url");

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE9ZyopUTxEEXpt3UjWjfgDljEiGodgbunj_UnXYc-1RlrXgNiDzAiikXoEP4g9_E/exec";

// https POST 요청 + Apps Script 리다이렉트 처리
function httpsPost(targetUrl, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const body = JSON.stringify(payload);

    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let data = "";

      // Apps Script는 종종 302로 응답하고 실제 결과는 리다이렉트 URL에 있음
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          httpsGet(redirectUrl, timeoutMs).then(resolve).catch(reject);
          return;
        }
      }

      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(body);
    req.end();
  });
}

function httpsGet(targetUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let data = "";

      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          httpsGet(redirectUrl, timeoutMs).then(resolve).catch(reject);
          return;
        }
      }

      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    console.log("[drive-upload] 요청 수신");

    const body = JSON.parse(event.body);
    const { role, filename, base64, mimetype } = body;

    if (!role || !base64) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "role과 base64 필수" }),
      };
    }

    console.log("[drive-upload] role=" + role + ", base64 size=" + base64.length);

    const payload = {
      action: "upload_image",
      role: role,
      filename: filename || ("image_" + Date.now() + ".jpg"),
      base64: base64,
      mimetype: mimetype || "image/jpeg",
    };

    const result = await httpsPost(APPS_SCRIPT_URL, payload, 28000);

    console.log("[drive-upload] Apps Script statusCode=" + result.statusCode);

    if (result.statusCode !== 200) {
      throw new Error("Apps Script HTTP " + result.statusCode + ": " + result.body.slice(0, 300));
    }

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch (e) {
      throw new Error("Apps Script JSON 파싱 실패: " + result.body.slice(0, 300));
    }

    if (!parsed.success) {
      throw new Error(parsed.error || "Apps Script 응답 실패");
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, data: parsed.data }),
    };

  } catch (err) {
    console.error("[drive-upload] 에러:", err.message);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message || "업로드 실패",
      }),
    };
  }
};
