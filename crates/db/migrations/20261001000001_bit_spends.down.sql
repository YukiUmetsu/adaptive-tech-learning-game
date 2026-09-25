-- Reverses `bit_spends`: the ledger goes back to non-negative (credit-only).
--
-- Debit rows cannot be represented by the restored constraint, so they are
-- removed first. This is acceptable for a forward-only deployment rollback: the
-- rows only describe in-mission Cyber Defense upgrades, and the wallet balances
-- they reduced are retained.
DELETE FROM bit_transactions WHERE amount < 0;

ALTER TABLE bit_transactions
    DROP CONSTRAINT bit_transactions_amount_non_zero;

ALTER TABLE bit_transactions
    ADD CONSTRAINT bit_transactions_amount_non_negative CHECK (amount >= 0);
