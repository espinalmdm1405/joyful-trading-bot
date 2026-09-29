WITH d AS (
  SELECT id, user_id, symbol, mt5_position_id,
         row_number() OVER (PARTITION BY user_id, symbol ORDER BY opened_at) rn
  FROM public.positions WHERE status = 'open'
), extra AS (
  SELECT user_id, symbol, string_agg(mt5_position_id, ',') ids FROM d WHERE rn > 1 AND mt5_position_id IS NOT NULL GROUP BY user_id, symbol
)
UPDATE public.positions p
SET mt5_position_id = concat_ws(',', p.mt5_position_id, e.ids)
FROM d, extra e
WHERE p.id = d.id AND d.rn = 1 AND e.user_id = d.user_id AND e.symbol = d.symbol;

UPDATE public.positions p
SET status = 'closed', close_reason = 'Unida a otra operación del mismo mercado', close_price = p.entry_price, pnl = 0, closed_at = now()
FROM (
  SELECT id, row_number() OVER (PARTITION BY user_id, symbol ORDER BY opened_at) rn
  FROM public.positions WHERE status = 'open'
) d
WHERE p.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS positions_one_open_per_symbol
  ON public.positions (user_id, symbol) WHERE status = 'open';