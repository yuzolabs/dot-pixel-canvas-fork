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

// CSVを埋め込み (ルートのng_words.csvと同一内容)
const NG_WORDS_CSV = `word
しね
死ね
殺す
ころす
コロス
自殺
じさつ
殺害
さつがい
暴力
ぼうりょく
テロ
てろ
あほ
阿呆
アホ
ばか
馬鹿
バカ
くず
クズ
ゴミ
ごみ
ゴミクズ
きもい
キモい
ブス
ぶす
醜女
うざい
ウザい
消えろ
きえろ
ガイジ
害児
障がい
障害
えろ
エロ
変態
へんたい
せっくす
セックス
性行為
ヤリたい
ちんこ
ちんちん
陰茎
まんこ
女性器
おっぱい
巨乳
貧乳
クリトリス
精子
せいし
射精
自慰
オナニー
ソープ
風俗
ふうぞく
援交
援助交際
ロリ
ペド
近親相姦
うんこ
うんち
糞
くそ
クソ
しっこ
尿
麻薬
覚醒剤
大麻
fuck
fck
fuk
shit
s hit
bitch
bich
asshole
ass hole
dick
cock
pussy
cunt
sex
sexy
kill
die
death
suicide
nigger
nigga
faggot
fag
whore
slut
rape
hitler
nazi
キチガイ
きちがい
気違い
屑
カス
かす
老害
害悪
デブ
でぶ
醜い
障害者
障がい者
カタワ
かたわ
オナニー
マスターベーション
マンコ
ペニス
ヴァギナ
アナル
肛門
陰毛
売春
パパ活
セフレ
ショタ
スカトロ
獣姦
強姦
輪姦
痴漢
盗撮
淫乱
ヘルス
ピンサロ
オナホ
バイブ
土人
シナ
チョン
ニガー
ジャップ
ホモ
レズ
オカマ
おかま
コカイン
ヘロイン
自決
硫化水素
練炭
爆破
爆弾
SEX
マンコ
チンコ
ちんこ
クリトリス
風俗
援交
レイプ
強姦
輪姦
エロ
淫乱
`;

function parseNgWordsCsv(csv: string): string[] {
  const lines = csv.trim().split("\n");
  return lines.slice(1).map((line) => line.trim()).filter(Boolean);
}

const NG_WORDS = parseNgWordsCsv(NG_WORDS_CSV);

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

  // NGワードチェック
  if (title) {
    for (const ng of NG_WORDS) {
      if (title.includes(ng)) {
        return { valid: false, error: "inappropriate title" };
      }
    }
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
 * エラーレスポンスを生成するヘルパー関数
 */
function createErrorResponse(error: string, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
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
      return createErrorResponse("Not Found", 404, headers);
    }

    // オリジンチェック
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin) && !allowedOrigins.includes("*")) {
      return createErrorResponse("Forbidden origin", 403, headers);
    }

    const rate = await env.RATE_LIMITER.limit({ key: ip });
    if (!rate.success) {
      return createErrorResponse("Rate limit exceeded. Try again later.", 429, headers);
    }

    // リクエストボディをパース
    let body: { title?: string; pixels?: string[] };
    try {
      body = await request.json();
    } catch {
      return createErrorResponse("Invalid JSON", 400, headers);
    }

    // 入力バリデーション
    const validation = validateInput(body);
    if (!validation.valid) {
      return createErrorResponse(validation.error || "Invalid input", 400, headers);
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
          body: supabaseBody.slice(0, 500),
        });
        return createErrorResponse("internal error", 500, headers);
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
      return createErrorResponse("Internal server error", 500, headers);
    }
  },
};
