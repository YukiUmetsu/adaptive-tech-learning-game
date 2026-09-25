-- Allow negative (debit) entries in the Bits ledger.
--
-- Rewards stay positive and are still written by `wallets::settle`. Spends are
-- written as negative amounts by `wallets::spend`, which also guards the wallet
-- so the balance can never go below zero. The unique `event_id` makes a retried
-- spend idempotent, exactly like a retried reward.
ALTER TABLE bit_transactions
    DROP CONSTRAINT bit_transactions_amount_non_negative;

ALTER TABLE bit_transactions
    ADD CONSTRAINT bit_transactions_amount_non_zero CHECK (amount <> 0);
