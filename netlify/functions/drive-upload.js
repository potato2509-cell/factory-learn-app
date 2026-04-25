// netlify/functions/drive-upload.js
// 학습앱 → Apps Script로 이미지 업로드 중계
// 학습앱은 mode: "no-cors"로 응답을 못 읽으므로,
// Netlify Function이 서버 간 호출(CORS 무관)로 중계하고 결과를 학습앱에 반환

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE9ZyopUTxEEXpt3UjWjfgDljEiGodgbunj_UnXYc-1RlrXgNiDzAiikXoEP4g9_E/exec";

exports.handler = async (event) => {
  // CORS preflight
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
    const body = JSON.parse(event.body);
    const { role, filename, base64, mimetype } = body;

    // 입력 검증
    if (!role || !base64) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "role과 base64 필수" }),
      };
    }

    // Apps Script에 전달
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload_image",
        role: role,
        filename: filename || `image_${Date.now()}.jpg`,
        base64: base64,
        mimetype: mimetype || "image/jpeg",
      }),
      // Netlify Function에서 서버 간 호출은 timeout 30초 정도
      signal: AbortSignal.timeout(28000),
    });

    if (!response.ok) {
      throw new Error(`Apps Script HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Apps Script 응답 실패");
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, data: data.data }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: err.message || "업로드 실패",
      }),
    };
  }
};
