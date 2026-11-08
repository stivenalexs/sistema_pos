-- Reconciliation: drop a transaction hint that belongs to another attempt
-- (plan step 12, D-040).
--
-- Found in the real sandbox test: the browser hint of one attempt pointed to
-- a transaction whose Wompi reference was another attempt. The payment was
-- applied to the right order (by its reference), but the wrong hint stayed
-- and the reconciliation job kept asking Wompi about it every 10 minutes.
--
-- Forward-only migration. Undo with a new migration, never by editing this one.

-- Clears the hint of p_attempt_id when the transaction it points to has a
-- different reference in Wompi. Returns true if the hint was cleared.
create function public.clear_mismatched_payment_hint(
  p_attempt_id uuid,
  p_transaction_id text,
  p_wompi_reference text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payment_attempts
  set transaction_id_hint = null
  where id = p_attempt_id
    and transaction_id_hint = p_transaction_id
    and reference is distinct from p_wompi_reference;
  return found;
end;
$$;

revoke all on function public.clear_mismatched_payment_hint(uuid, text, text) from public, anon, authenticated;
grant execute on function public.clear_mismatched_payment_hint(uuid, text, text) to service_role;
