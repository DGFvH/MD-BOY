-- Confirmed test accounts for the end-to-end tests (no email is sent).
-- Replace :password with the value of E2E_PASSWORD from .env.test.local, then run
-- this in the SQL editor. Remove them with:
--   delete from auth.users where email like 'e2e-%@hashlite.test';
with u as (
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    reauthentication_token, phone_change, phone_change_token)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e,
    extensions.crypt(':password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  from unnest(array['e2e-1@hashlite.test', 'e2e-2@hashlite.test']) as e
  returning id, email
)
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from u;
