-- Connector for AI assistants: OAuth 2.1 (PKCE, dynamic client registration) and the
-- functions the account MCP endpoint (api/account-mcp.js) calls.
--
-- Everything security-relevant happens here, so the web functions need no secret key:
-- tokens are random, handed out once, and stored only as SHA-256 hashes; a connector call
-- proves its access token, then runs the app's own functions as that user (auth.uid()).

-- ---- Tables (private schema: not reachable through the API) -------------------------
create table private.oauth_clients (
  id            text primary key,
  name          text not null check (char_length(name) between 1 and 100),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at    timestamptz not null default now()
);

create table private.oauth_codes (
  code_hash      text primary key,
  client_id      text not null references private.oauth_clients (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  scope          text not null default 'documents',
  expires_at     timestamptz not null default now() + interval '10 minutes'
);
create index on private.oauth_codes (client_id);
create index on private.oauth_codes (user_id);

-- One row per connection; refreshing rotates both tokens in place.
create table private.connector_tokens (
  id                 uuid primary key default gen_random_uuid(),
  client_id          text not null references private.oauth_clients (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  scope              text not null default 'documents',
  access_hash        text not null unique,
  access_expires_at  timestamptz not null,
  refresh_hash       text not null unique,
  refresh_expires_at timestamptz not null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz
);
create index on private.connector_tokens (client_id);
create index on private.connector_tokens (user_id);

revoke all on private.oauth_clients, private.oauth_codes, private.connector_tokens from public, anon, authenticated;

-- ---- Helpers --------------------------------------------------------------------------
create function private.token_hash(t text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(t, 'sha256'), 'hex')
$$;

-- base64url of n random bytes, without padding.
create function private.random_token(n integer) returns text
language sql volatile set search_path = '' as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(n), 'base64'), E'+/\n', '-_'), '=')
$$;

create function private.oauth_error(code text, message text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'HL400', message = message, detail = code;
end $$;

-- An allowed redirect: https, or http on this machine (for local tools).
create function private.valid_redirect(uri text) returns boolean
language sql immutable set search_path = '' as $$
  select char_length(uri) <= 500
     and (uri ~ '^https://[^\s#]+$' or uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/[^\s#]*)?$')
$$;

-- Issues a new token pair for a connection (inserting it, or rotating an existing row).
create function private.issue_tokens(p_client text, p_user uuid, p_scope text, p_row uuid default null)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  access text := 'hla_' || private.random_token(32);
  refresh text := 'hlr_' || private.random_token(32);
begin
  if p_row is null then
    insert into private.connector_tokens (client_id, user_id, scope, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
    values (p_client, p_user, p_scope, private.token_hash(access), now() + interval '1 hour',
            private.token_hash(refresh), now() + interval '30 days');
  else
    update private.connector_tokens
       set access_hash = private.token_hash(access), access_expires_at = now() + interval '1 hour',
           refresh_hash = private.token_hash(refresh), refresh_expires_at = now() + interval '30 days'
     where id = p_row;
  end if;
  return jsonb_build_object('access_token', access, 'token_type', 'Bearer', 'expires_in', 3600,
                            'refresh_token', refresh, 'scope', p_scope);
end $$;

-- Checks a connector access token and makes auth.uid() return its user for the rest of
-- this transaction, so the app's functions and ownership checks apply as they are.
create function private.act_as(p_token text) returns uuid
language plpgsql set search_path = '' as $$
declare t private.connector_tokens;
begin
  select * into t from private.connector_tokens
   where access_hash = private.token_hash(coalesce(p_token, ''))
     and revoked_at is null and access_expires_at > now();
  if not found then
    raise exception using errcode = 'HL401', message = 'The access token is invalid or has expired.';
  end if;
  if t.last_used_at is null or t.last_used_at < now() - interval '1 minute' then
    update private.connector_tokens set last_used_at = now() where id = t.id;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.user_id, 'role', 'authenticated')::text, true);
  return t.user_id;
end $$;

-- ---- OAuth ------------------------------------------------------------------------------
-- Dynamic client registration (RFC 7591). Clients that never got a token are removed after a day.
create function public.oauth_register_client(p_name text, p_redirect_uris text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := 'hlc_' || private.random_token(16);
begin
  if p_redirect_uris is null or cardinality(p_redirect_uris) = 0 or cardinality(p_redirect_uris) > 10
     or exists (select 1 from unnest(p_redirect_uris) u where not private.valid_redirect(u)) then
    perform private.oauth_error('invalid_redirect_uri', 'Redirect URIs must use https (or http on localhost).');
  end if;
  delete from private.oauth_clients c
   where c.created_at < now() - interval '1 day'
     and not exists (select 1 from private.connector_tokens t where t.client_id = c.id);
  insert into private.oauth_clients (id, name, redirect_uris)
  values (v_id, coalesce(nullif(left(btrim(coalesce(p_name, '')), 100), ''), 'An application'), p_redirect_uris);
  return v_id;
end $$;

-- For the consent page: the client's name, if client and redirect belong together.
create function public.oauth_client_info(p_client_id text, p_redirect_uri text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare n text;
begin
  select name into n from private.oauth_clients where id = p_client_id and p_redirect_uri = any (redirect_uris);
  if n is null then
    perform private.oauth_error('invalid_request', 'Unknown application or redirect address.');
  end if;
  return n;
end $$;

-- After "Allow" on the consent page (signed in): a single-use code for 10 minutes.
create function public.oauth_create_code(p_client_id text, p_redirect_uri text, p_code_challenge text, p_scope text default 'documents')
returns text
language plpgsql security definer set search_path = '' as $$
declare code text := 'hlo_' || private.random_token(32);
begin
  if auth.uid() is null then
    raise exception using errcode = 'HL401', message = 'Please sign in.';
  end if;
  perform public.oauth_client_info(p_client_id, p_redirect_uri);
  if coalesce(p_code_challenge, '') !~ '^[A-Za-z0-9_-]{43}$' then
    perform private.oauth_error('invalid_request', 'A PKCE code challenge (S256) is required.');
  end if;
  delete from private.oauth_codes where expires_at < now();
  insert into private.oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope)
  values (private.token_hash(code), p_client_id, auth.uid(), p_redirect_uri, p_code_challenge, 'documents');
  return code;
end $$;

-- Token endpoint, authorization_code grant (PKCE S256 required, code used once).
create function public.oauth_exchange_code(p_code text, p_verifier text, p_client_id text, p_redirect_uri text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.oauth_codes;
begin
  delete from private.oauth_codes where code_hash = private.token_hash(coalesce(p_code, '')) returning * into c;
  if not found or c.expires_at < now() or c.client_id is distinct from p_client_id or c.redirect_uri is distinct from p_redirect_uri then
    perform private.oauth_error('invalid_grant', 'The code is invalid, expired or already used.');
  end if;
  if coalesce(p_verifier, '') !~ '^[A-Za-z0-9._~-]{43,128}$'
     or rtrim(translate(encode(extensions.digest(p_verifier, 'sha256'), 'base64'), E'+/\n', '-_'), '=') <> c.code_challenge then
    perform private.oauth_error('invalid_grant', 'The code verifier does not match.');
  end if;
  return private.issue_tokens(c.client_id, c.user_id, c.scope);
end $$;

-- Token endpoint, refresh_token grant: the old refresh token stops working.
create function public.oauth_refresh(p_refresh_token text, p_client_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t private.connector_tokens;
begin
  select * into t from private.connector_tokens
   where refresh_hash = private.token_hash(coalesce(p_refresh_token, '')) for update;
  if not found or t.revoked_at is not null or t.refresh_expires_at < now() or t.client_id is distinct from p_client_id then
    perform private.oauth_error('invalid_grant', 'The refresh token is invalid, expired or revoked.');
  end if;
  return private.issue_tokens(t.client_id, t.user_id, t.scope, t.id);
end $$;

-- ---- Connected apps (Account dialog) ---------------------------------------------------
create function public.connector_list()
returns table (id uuid, name text, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, c.name, t.created_at, t.last_used_at
    from private.connector_tokens t join private.oauth_clients c on c.id = t.client_id
   where t.user_id = auth.uid() and t.revoked_at is null and t.refresh_expires_at > now()
   order by t.created_at desc
$$;

create function public.connector_revoke(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update private.connector_tokens set revoked_at = now()
   where id = p_id and user_id = auth.uid() and revoked_at is null
$$;

-- ---- What the connector can do (each call proves its access token) -----------------
create function public.mcp_list(p_token text, p_limit integer default 50)
returns table (id uuid, title text, folder text, updated_at timestamptz, shared boolean)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.act_as(p_token);
begin
  return query
    select d.id, d.title, f.name, d.updated_at, d.share_token is not null
      from public.documents d left join public.folders f on f.id = d.folder_id
     where d.user_id = uid and d.deleted_at is null
     order by d.updated_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

create function public.mcp_search(p_token text, p_query text)
returns table (id uuid, title text, excerpt text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.act_as(p_token);
  return query
    select s.id, s.title, replace(replace(s.excerpt, chr(2), '**'), chr(3), '**'), s.updated_at
      from public.search_documents(p_query) s
     limit 25;
end $$;

create function public.mcp_read(p_token text, p_id uuid)
returns table (id uuid, title text, content text, version integer, folder text, updated_at timestamptz, share_token text)
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.act_as(p_token);
begin
  return query
    select d.id, d.title, d.content, d.version, f.name, d.updated_at, d.share_token
      from public.documents d left join public.folders f on f.id = d.folder_id
     where d.id = p_id and d.user_id = uid and d.deleted_at is null;
  if not found then
    raise exception using errcode = 'HL404', message = 'Document not found.';
  end if;
end $$;

create function public.mcp_create(p_token text, p_title text, p_content text)
returns table (id uuid, title text, version integer)
language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  perform private.act_as(p_token);
  d := public.create_document(p_title, p_content);
  return query select d.id, d.title, d.version;
end $$;

-- Replaces the text (and optionally the title). The text being replaced always goes into
-- version history first, so any change can be undone in the app. p_version guards against
-- overwriting edits made since the document was read.
create function public.mcp_update(p_token text, p_id uuid, p_content text, p_title text default null, p_version integer default null)
returns table (id uuid, title text, version integer)
language plpgsql security definer set search_path = '' as $$
declare d public.documents;
begin
  perform private.act_as(p_token);
  d := public.save_document(p_id, p_title, p_content, p_version => p_version, p_keep_current => true);
  return query select d.id, d.title, d.version;
end $$;

create function public.mcp_share(p_token text, p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.act_as(p_token);
  tok text;
begin
  update public.documents set share_token = coalesce(share_token, private.random_token(16))
   where id = p_id and user_id = uid and deleted_at is null
  returning share_token into tok;
  if tok is null then
    raise exception using errcode = 'HL404', message = 'Document not found.';
  end if;
  return tok;
end $$;

-- ---- Who may call what -------------------------------------------------------------------
revoke execute on function
  private.token_hash(text), private.random_token(integer), private.oauth_error(text, text), private.valid_redirect(text),
  private.issue_tokens(text, uuid, text, uuid), private.act_as(text),
  public.oauth_register_client(text, text[]), public.oauth_client_info(text, text),
  public.oauth_create_code(text, text, text, text), public.oauth_exchange_code(text, text, text, text),
  public.oauth_refresh(text, text), public.connector_list(), public.connector_revoke(uuid),
  public.mcp_list(text, integer), public.mcp_search(text, text), public.mcp_read(text, uuid),
  public.mcp_create(text, text, text), public.mcp_update(text, uuid, text, text, integer), public.mcp_share(text, uuid)
  from public, anon, authenticated;

-- Callable without a login: registration, the consent page's check, the token endpoint,
-- and the connector functions (which require a valid access token).
grant execute on function
  public.oauth_register_client(text, text[]), public.oauth_client_info(text, text),
  public.oauth_exchange_code(text, text, text, text), public.oauth_refresh(text, text),
  public.mcp_list(text, integer), public.mcp_search(text, text), public.mcp_read(text, uuid),
  public.mcp_create(text, text, text), public.mcp_update(text, uuid, text, text, integer), public.mcp_share(text, uuid)
  to anon, authenticated;

-- Signed in only.
grant execute on function public.oauth_create_code(text, text, text, text), public.connector_list(), public.connector_revoke(uuid)
  to authenticated;
