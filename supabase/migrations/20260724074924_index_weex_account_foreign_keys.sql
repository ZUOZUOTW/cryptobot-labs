create index weex_account_snapshots_connection_user_idx
  on public.weex_account_snapshots(connection_id, user_id);

create index weex_realized_pnl_connection_user_idx
  on public.weex_realized_pnl_ledger(connection_id, user_id);
