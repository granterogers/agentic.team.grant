-- STUB pg_net. A zero-state proof must not make outbound network calls, so the
-- request is recorded and an id returned, which is the real signature.
create table net.http_request_queue (
  id bigserial primary key, method text not null, url text not null,
  headers jsonb, body jsonb, timeout_ms int,
  created_at timestamptz not null default now()
);
create function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into net.http_request_queue (method, url, headers, body, timeout_ms)
  values ('POST', url, headers, body, timeout_milliseconds) returning id into v_id;
  return v_id;
end $$;
