# Supabase migrations: exchange_art

このディレクトリには RPC `exchange_art` と関連テーブルを作成する SQL を含みます。

## 作成されるオブジェクト

- `public.art_posts` テーブル
  - 列
    - `id` (uuid, PK, default gen_random_uuid())
    - `title` (text, default 'むだい')
    - `pixels` (text, JSON array を期待)
    - `exchanged` (boolean, default false)
    - `created_at` (timestamptz, default now())
  - 補足: `pixels` の JSON 配列長や色コード形式はアプリ側バリデーションに依存します
- インデックス: `idx_art_posts_waiting` (partial, `where exchanged = false` on `created_at`)
- RPC: `public.exchange_art(new_title text, new_pixels text) returns jsonb`
  - 交換待ち投稿を1件ロックして取得し、呼び出し元の投稿を挿入。見つかった場合は相手の投稿 JSON を返却、見つからなければ `null` を返却
  - `SECURITY DEFINER` で実行し、`authenticated`/`anon` に `EXECUTE` を付与

## インデックスの意図

- 交換待ち (`exchanged = false`) の行だけを素早く絞り込むため partial index を作成しています。
- `order by random()` は全件スキャンになるため、極端に件数が増える場合は別方式（例えばキュー化）を検討してください。
