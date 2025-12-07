-- Migration: art_posts schema + exchange_art RPC
-- Public repository safe: no secrets are stored. Values are runtime-provided via Supabase/Worker.

-- Enable UUID generation (Supabase environments already allow this)
create extension if not exists "pgcrypto";

-- Core table
create table if not exists public.art_posts (
    id uuid primary key default gen_random_uuid(),
    title text not null default 'むだい',
    pixels text not null,
    exchanged boolean not null default false,
    created_at timestamptz not null default now()
);

comment on table public.art_posts is '4x4 pixel diary posts awaiting exchange';
comment on column public.art_posts.pixels is 'JSON array (length 16) of 6-digit hex color strings';

-- Partial index to speed up selection of unmatched posts.
create index if not exists idx_art_posts_waiting
    on public.art_posts (created_at)
    where exchanged = false;

-- RPC: exchange_art
create or replace function public.exchange_art(new_title text, new_pixels text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    found_post record;
    new_post_id uuid;
begin
    -- pick one unmatched post at random (skip locked to avoid contention)
    select id, title, pixels, created_at
    into found_post
    from public.art_posts
    where exchanged = false
    order by random()
    limit 1
    for update skip locked;

    -- insert the caller's post
    insert into public.art_posts (title, pixels, exchanged)
    values (new_title, new_pixels, false)
    returning id into new_post_id;

    if found_post is not null then
        update public.art_posts
        set exchanged = true
        where id = found_post.id;

        return jsonb_build_object(
            'id', found_post.id,
            'title', found_post.title,
            'pixels', found_post.pixels,
            'created_at', found_post.created_at
        );
    end if;

    return null;
end;
$$;

-- Allow RPC access from client roles
grant execute on function public.exchange_art(text, text) to authenticated, anon;
