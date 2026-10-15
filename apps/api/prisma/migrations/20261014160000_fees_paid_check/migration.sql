-- Review of #20: a due's paid total can never exceed its net payable. The API
-- already refuses overpayment and a net below what was paid, under a lock on
-- the due; this check is the backstop. (Writing a fee off is a Paid or Waived
-- status override, not a paid total above the net.)
-- Before deploying, this must return no rows:
--   SELECT "id" FROM "FeeDue" WHERE "paidPaise" > "netPaise";
BEGIN;

ALTER TABLE "FeeDue" ADD CONSTRAINT "FeeDue_paid_check" CHECK ("paidPaise" <= "netPaise");

COMMIT;
