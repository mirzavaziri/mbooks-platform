-- Phone becomes the primary identity for accounts created through the
-- arith.land gateway SSO handoff; email stays for the existing
-- admin-issued invite/reset-link accounts that predate it, so neither
-- column can stay a hard "not null" on its own.
alter table users alter column email drop not null;
alter table users alter column password_hash drop not null;
alter table users add column phone text unique;
alter table users add constraint users_identity_check check (email is not null or phone is not null);
