/**
 * Cloudflare Workers - Supabase Proxy with Rate Limiting & CORS
 *
 * 機能:
 * - CORS 制御 (許可オリジン限定)
 * - IP ベースレートリミット (KV 使用)
 * - 入力バリデーション
 * - Supabase RPC 呼び出しプロキシ
 */

export interface Env {
  // Supabase 認証情報 (wrangler secret put で設定)
  // 実際には anon key を利用する
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;

  // Workers Rate Limiting binding (wrangler.toml で binding)
  RATE_LIMITER: RateLimitBinding;

  // 許可するオリジン (カンマ区切りで複数可)
  ALLOWED_ORIGINS?: string;
}


// 入力制限
const MAX_TITLE_LENGTH = 5;
const MAX_PIXELS_LENGTH = 16;

/**
 * CORS ヘッダを生成
 */
function corsHeaders(origin: string, allowedOrigins: string[]): HeadersInit {
  const isAllowed = allowedOrigins.some(
    (o) => o === origin || o === "*"
  );
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * レートリミットチェック (IP ベース)
 */
interface RateLimitResult {
  success: boolean;
  remaining?: number;
  reset?: number;
}

interface RateLimitBinding {
  limit(options: { key: string }): Promise<RateLimitResult>;
}

/**
 * 入力バリデーション
 */
function validateInput(body: {
  title?: string;
  pixels?: string[];
}): { valid: boolean; error?: string } {
  const { title, pixels } = body;

  // タイトル検証
  if (title !== undefined && typeof title !== "string") {
    return { valid: false, error: "title must be a string" };
  }
  if (title && title.length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `title max ${MAX_TITLE_LENGTH} chars` };
  }

  // ピクセル検証
  if (!Array.isArray(pixels)) {
    return { valid: false, error: "pixels must be an array" };
  }
  if (pixels.length !== MAX_PIXELS_LENGTH) {
    return { valid: false, error: `pixels must have ${MAX_PIXELS_LENGTH} items` };
  }
  // 各要素が色コードかチェック (簡易)
  const colorRegex = /^#[0-9a-fA-F]{6}$/;
  for (const p of pixels) {
    if (typeof p !== "string" || !colorRegex.test(p)) {
      return { valid: false, error: "invalid pixel color format" };
    }
  }

  return { valid: true };
}

/**
 * Supabase RPC 呼び出し
 */
async function callSupabaseRpc(
  supabaseUrl: string,
  anonKey: string,
  title: string,
  pixels: string[]
): Promise<Response> {
  const rpcUrl = `${supabaseUrl}/rest/v1/rpc/exchange_art`;

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      new_title: title || "むだい",
      new_pixels: JSON.stringify(pixels),
    }),
  });

  return res;
}

/**
 * メインハンドラ
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    // 許可オリジンをパース
    const allowedOrigins = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    const headers = corsHeaders(origin, allowedOrigins);

    // CORS プリフライト
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // エンドポイント: POST /exchange のみ
    if (url.pathname !== "/exchange" || request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // オリジンチェック
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin) && !allowedOrigins.includes("*")) {
      return new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const rate = await env.RATE_LIMITER.limit({ key: ip });
    if (!rate.success) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
        {
          status: 429,
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // リクエストボディをパース
    let body: { title?: string; pixels?: string[] };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // 入力バリデーション
    const validation = validateInput(body);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: validation.error }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Supabase RPC 呼び出し
    try {
      const supabaseRes = await callSupabaseRpc(
        env.SUPABASE_URL,
        env.SUPABASE_ANON_KEY,
        body.title || "",
        body.pixels!
      );

      const supabaseBody = await supabaseRes.text();

      // 成功時のみSupabaseのボディを透過。エラー時は詳細を返さず内部エラーに統一。
      if (!supabaseRes.ok) {
        console.error("Supabase error", {
          status: supabaseRes.status,
          body: supabaseBody?.slice(0, 500),
        });
        return new Response(
          JSON.stringify({ error: "internal error" }),
          {
            status: 500,
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return new Response(supabaseBody, {
        status: supabaseRes.status,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      console.error("Supabase call failed:", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
  },
};
