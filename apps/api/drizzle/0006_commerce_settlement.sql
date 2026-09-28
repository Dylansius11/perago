-- A bound execution remains leased until finalized commerce payout or refund state.
alter type execution_status add value 'REFUNDING';
alter type execution_transaction_kind add value 'SETTLE';
alter type execution_transaction_kind add value 'REJECT_JOB';
alter type execution_transaction_kind add value 'CLAIM_REFUND';
